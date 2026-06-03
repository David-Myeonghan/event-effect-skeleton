// step-07a-outbox — 로컬 상태를 서버(영속 store)에 내보낸다 (실패 시 backoff 재시도).
//
// step-06b 와 다른 점 (이것만 추가):
//   - PERSIST_TIMER effect 추가 — reducer 가 "이 스냅샷을 영속해라" 를 데이터로 요청.
//   - Outbox 가 그 요청을 받아 store.upsert 를 호출하고, 실패하면 backoff 로 재시도.
//   - 로컬 state 는 즉시 반영(optimistic), 영속 실패해도 rollback 하지 않는다(eventual).
//
// 아직 "시작 시 복원(reconcile)" 은 없다 — 그건 step-07b.

type TimerStatus = 'PENDING' | 'RUNNING' | 'DONE';
interface Timer { id: string; status: TimerStatus; token: number | null; }
interface TimerSnapshot { id: string; status: TimerStatus; }
interface State {
  timers: ReadonlyMap<string, Timer>;
  order: readonly string[];
  maxConcurrent: number;
}

type Event =
  | { kind: 'ADD_TIMER'; id: string }
  | { kind: 'TIMER_FINISHED'; id: string; token: number };

type Effect =
  | { kind: 'SCHEDULE_TIMER'; id: string; token: number; ms: number }
  | { kind: 'PERSIST_TIMER'; snapshot: TimerSnapshot }
  | { kind: 'LOG'; message: string };
type ReduceResult = { state: State; effects: Effect[] };

// ─── drain (step-06b 와 동일하되, 승격할 때 PERSIST_TIMER 도 함께 발행) ─────
function drain(state: State, issueToken: () => number): ReduceResult {
  let running = 0;
  for (const t of state.timers.values()) if (t.status === 'RUNNING') running += 1;
  const free = state.maxConcurrent - running;
  if (free <= 0) return { state, effects: [] };

  const candidates: Timer[] = [];
  for (const id of state.order) {
    const t = state.timers.get(id);
    if (t && t.status === 'PENDING') candidates.push(t);
    if (candidates.length >= free) break;
  }
  if (candidates.length === 0) return { state, effects: [] };

  const newTimers = new Map(state.timers);
  const effects: Effect[] = [];
  for (const t of candidates) {
    const token = issueToken();
    newTimers.set(t.id, { ...t, status: 'RUNNING', token });
    effects.push({ kind: 'SCHEDULE_TIMER', id: t.id, token, ms: 500 });
    effects.push({ kind: 'PERSIST_TIMER', snapshot: { id: t.id, status: 'RUNNING' } });
  }
  return { state: { ...state, timers: newTimers }, effects };
}

function createReducer(issueToken: () => number) {
  return function reduce(state: State, event: Event): ReduceResult {
    switch (event.kind) {
      case 'ADD_TIMER': {
        if (state.timers.has(event.id)) return { state, effects: [] };
        const newTimer: Timer = { id: event.id, status: 'PENDING', token: null };
        const next: State = {
          ...state,
          timers: new Map(state.timers).set(event.id, newTimer),
          order: [...state.order, event.id],
        };
        const drained = drain(next, issueToken);
        // PENDING 으로 들어온 사실부터 영속하고, drain 이 만든 effect(RUNNING 영속 등)를 뒤에 붙인다.
        return {
          state: drained.state,
          effects: [{ kind: 'PERSIST_TIMER', snapshot: { id: event.id, status: 'PENDING' } }, ...drained.effects],
        };
      }
      case 'TIMER_FINISHED': {
        const t = state.timers.get(event.id);
        if (!t) return { state, effects: [] };
        if (t.token !== event.token) {
          return { state, effects: [{ kind: 'LOG', message: `stale result for ${event.id} token=${event.token} — ignored` }] };
        }
        const done: Timer = { ...t, status: 'DONE', token: null };
        const next: State = { ...state, timers: new Map(state.timers).set(event.id, done) };
        const drained = drain(next, issueToken);
        return {
          state: drained.state,
          effects: [{ kind: 'PERSIST_TIMER', snapshot: { id: event.id, status: 'DONE' } }, ...drained.effects],
        };
      }
    }
  };
}

// ─── Runtime ───────────────────────────────────────────────
type Interpreter<TEffect, TEvent> = (e: TEffect, dispatch: (e: TEvent) => void) => void;

class Runtime<TState, TEvent, TEffect> {
  private state: TState;
  private readonly listeners = new Set<(s: TState) => void>();
  constructor(
    initial: TState,
    private readonly reducer: (s: TState, e: TEvent) => { state: TState; effects: TEffect[] },
    private readonly interpreter: Interpreter<TEffect, TEvent>,
  ) { this.state = initial; }
  getState(): TState { return this.state; }
  dispatch(event: TEvent): void {
    const { state, effects } = this.reducer(this.state, event);
    this.state = state;
    for (const l of this.listeners) l(state);
    for (const effect of effects) this.interpreter(effect, (e) => this.dispatch(e));
  }
  subscribe(l: (s: TState) => void): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
}

// ─── 영속 Store + Outbox (backoff retry) ───────────────────
class FakeStore {
  private readonly map = new Map<string, TimerSnapshot>();
  private failuresLeft: number;
  constructor(seed: TimerSnapshot[] = [], failNextUpserts = 0) {
    for (const s of seed) this.map.set(s.id, s);
    this.failuresLeft = failNextUpserts;
  }
  async upsert(s: TimerSnapshot): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error(`store upsert failed (left=${this.failuresLeft})`);
    }
    this.map.set(s.id, s);
  }
  async list(): Promise<TimerSnapshot[]> { return Array.from(this.map.values()); }
  inspect(): TimerSnapshot[] { return Array.from(this.map.values()); }
}

class Outbox {
  private readonly pending: { snapshot: TimerSnapshot; attempts: number }[] = [];
  private flushing = false;
  constructor(private readonly store: FakeStore) {}
  enqueue(snapshot: TimerSnapshot): void {
    this.pending.push({ snapshot, attempts: 0 });
    void this.flush();
  }
  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    while (this.pending.length > 0) {
      const item = this.pending[0];
      if (!item) break;
      try {
        await this.store.upsert(item.snapshot);
        this.pending.shift();
      } catch (err) {
        item.attempts += 1;
        const delay = Math.min(1000, 50 * Math.pow(2, item.attempts - 1));
        console.log(`[outbox] retry ${item.snapshot.id} attempt=${item.attempts} after ${delay}ms: ${(err as Error).message}`);
        // 출력(주입한 실패 1회): [outbox] retry a attempt=1 after 50ms: store upsert failed (left=0)
        this.flushing = false;
        setTimeout(() => { void this.flush(); }, delay);
        return;
      }
    }
    this.flushing = false;
  }
}

// ─── Wiring ─────────────────────────────────────────────────
let tokenSeq = 0;
const reduce = createReducer(() => (tokenSeq += 1));

// 첫 upsert 1회는 실패하도록 주입 (네트워크 플레이크 시뮬). seed 는 비어 있음.
const store = new FakeStore([], 1);
const outbox = new Outbox(store);

const interpret: Interpreter<Effect, Event> = (effect, dispatch) => {
  switch (effect.kind) {
    case 'SCHEDULE_TIMER':
      setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', id: effect.id, token: effect.token }), effect.ms);
      return;
    case 'PERSIST_TIMER':
      outbox.enqueue(effect.snapshot);
      return;
    case 'LOG':
      console.log(`[effect] ${effect.message}`);
      return;
  }
};

const initial: State = { timers: new Map(), order: [], maxConcurrent: 2 };
const rt = new Runtime<State, Event, Effect>(initial, reduce, interpret);

const summary = (s: State): string =>
  Array.from(s.timers.values()).map((t) => `${t.id}=${t.status}`).join(', ');
rt.subscribe((s) => console.log(`[state] ${summary(s)}`));

async function main(): Promise<void> {
  console.log('--- 잡 a, b, c 추가 (maxConcurrent=2, 첫 upsert 1회 실패 주입) ---');
  rt.dispatch({ kind: 'ADD_TIMER', id: 'a' });
  rt.dispatch({ kind: 'ADD_TIMER', id: 'b' });
  rt.dispatch({ kind: 'ADD_TIMER', id: 'c' });

  await new Promise((r) => setTimeout(r, 1500));

  console.log('--- 최종 상태 (로컬 = 서버 로 수렴) ---');
  console.log('memory :', summary(rt.getState()));
  console.log('store  :', store.inspect().map((s) => `${s.id}=${s.status}`).join(', '));
}

void main();

// ─── 종합 출력 (실행으로 검증) ──────────────────────────────
// --- 잡 a, b, c 추가 (maxConcurrent=2, 첫 upsert 1회 실패 주입) ---
// [state] a=RUNNING                                                     ← a 즉시 RUNNING
// [state] a=RUNNING, b=RUNNING                                          ← 슬롯 가득
// [state] a=RUNNING, b=RUNNING, c=PENDING                               ← c 는 대기
// [outbox] retry a attempt=1 after 50ms: store upsert failed (left=0)   ← 첫 upsert 실패 → 재시도
// [state] a=DONE, b=RUNNING, c=RUNNING                                  ← a 완료 → c 승격
// [state] a=DONE, b=DONE, c=RUNNING                                     ← b 완료
// [state] a=DONE, b=DONE, c=DONE                                        ← c 완료
// --- 최종 상태 (로컬 = 서버 로 수렴) ---
// memory : a=DONE, b=DONE, c=DONE
// store  : a=DONE, b=DONE, c=DONE        ← 영속이 한 번 실패했어도 재시도로 결국 일치 (eventual)
