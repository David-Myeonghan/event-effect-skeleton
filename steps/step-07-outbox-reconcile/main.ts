// step-07-outbox-reconcile — 영속(Outbox) + 시작 시 복원(Reconcile).
//
// step-06 + 다음 추가:
//   - PERSIST_TIMER effect → Outbox 가 backoff retry 로 store 에 upsert.
//   - 부트스트랩 시 store.list() → SNAPSHOT_RECEIVED event 발행 → reducer 가 흡수.
//   - 로컬은 optimistic(즉시 반영), 영속은 eventual(rollback 없음).

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
  | { kind: 'TIMER_FINISHED'; id: string; token: number }
  | { kind: 'SNAPSHOT_RECEIVED'; rows: readonly TimerSnapshot[] };

type Effect =
  | { kind: 'SCHEDULE_TIMER'; id: string; token: number; ms: number }
  | { kind: 'PERSIST_TIMER'; snapshot: TimerSnapshot };
type ReduceResult = { state: State; effects: Effect[] };

// ─── drain (step-06 과 동일) ──────────────────────────────
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
    const upgraded: Timer = { ...t, status: 'RUNNING', token };
    newTimers.set(t.id, upgraded);
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
        return {
          state: drained.state,
          effects: [{ kind: 'PERSIST_TIMER', snapshot: { id: event.id, status: 'PENDING' } }, ...drained.effects],
        };
      }
      case 'TIMER_FINISHED': {
        const t = state.timers.get(event.id);
        if (!t || t.token !== event.token) return { state, effects: [] };
        const done: Timer = { ...t, status: 'DONE', token: null };
        const next: State = { ...state, timers: new Map(state.timers).set(event.id, done) };
        const drained = drain(next, issueToken);
        return {
          state: drained.state,
          effects: [{ kind: 'PERSIST_TIMER', snapshot: { id: event.id, status: 'DONE' } }, ...drained.effects],
        };
      }
      case 'SNAPSHOT_RECEIVED': {
        // 정책: 로컬에 없는 row 는 add. 단 RUNNING 상태로 온 건 PENDING 으로 정규화
        // (다른 디바이스에서 RUNNING 일 수 있지만 이 인스턴스는 그 run 의 소유자가 아니다).
        const newTimers = new Map(state.timers);
        const newOrder = [...state.order];
        for (const row of event.rows) {
          if (newTimers.has(row.id)) continue;
          const status: TimerStatus = row.status === 'RUNNING' ? 'PENDING' : row.status;
          newTimers.set(row.id, { id: row.id, status, token: null });
          newOrder.push(row.id);
        }
        const next: State = { ...state, timers: newTimers, order: newOrder };
        return drain(next, issueToken);
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
  async list(): Promise<TimerSnapshot[]> {
    return Array.from(this.map.values());
  }
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

// 이전 세션 잔재 시뮬레이션: 'x' 가 store 에 PENDING 으로 남아 있다고 치자.
// 그리고 첫 upsert 1회는 실패 (네트워크 플레이크 시뮬).
const store = new FakeStore([{ id: 'x', status: 'PENDING' }], 1);
const outbox = new Outbox(store);

const interpret: Interpreter<Effect, Event> = (effect, dispatch) => {
  switch (effect.kind) {
    case 'SCHEDULE_TIMER':
      setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', id: effect.id, token: effect.token }), effect.ms);
      return;
    case 'PERSIST_TIMER':
      outbox.enqueue(effect.snapshot);
      return;
  }
};

const initial: State = { timers: new Map(), order: [], maxConcurrent: 2 };
const rt = new Runtime<State, Event, Effect>(initial, reduce, interpret);

const summary = (s: State): string =>
  Array.from(s.timers.values()).map((t) => `${t.id}=${t.status}`).join(', ');
rt.subscribe((s) => console.log(`[state] ${summary(s)}`));

async function main(): Promise<void> {
  console.log('--- 부트스트랩: store 에서 list → SNAPSHOT_RECEIVED 로 흡수 ---');
  const rows = await store.list();
  rt.dispatch({ kind: 'SNAPSHOT_RECEIVED', rows });

  console.log('--- 새 잡 y, z 추가 ---');
  rt.dispatch({ kind: 'ADD_TIMER', id: 'y' });
  rt.dispatch({ kind: 'ADD_TIMER', id: 'z' });

  await new Promise((r) => setTimeout(r, 1500));

  console.log('--- 최종 상태 ---');
  console.log('memory :', summary(rt.getState()));
  console.log('store  :', store.inspect().map((s) => `${s.id}=${s.status}`).join(', '));
}

void main();
