// step-07b-reconcile — 앱 시작 시 서버 상태를 흡수해 메모리를 복원한다.
//
// step-07a 와 다른 점 (이것만 추가):
//   - SNAPSHOT_RECEIVED event 추가 — 서버에서 받아온 row 목록을 도메인 입구로 들여보낸다.
//   - 부트스트랩: store.list() → SNAPSHOT_RECEIVED dispatch → reducer 가 정책대로 흡수.
//   - 정규화 정책: 서버가 RUNNING 으로 줘도, 이 인스턴스는 그 run 의 소유자가 아니므로
//     PENDING 으로 낮춰 받은 뒤 drain 이 다시 자기 token 으로 RUNNING 승격한다.
//
// 이로써 "로컬=mirror, durable=진실, 시작 시 rehydrate" 가 완성된다.

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
  | { kind: 'PERSIST_TIMER'; snapshot: TimerSnapshot }
  | { kind: 'LOG'; message: string };
type ReduceResult = { state: State; effects: Effect[] };

// ─── drain (step-07a 와 동일) ──────────────────────────────
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
      case 'SNAPSHOT_RECEIVED': {
        // 정책: 로컬에 없는 row 만 add. RUNNING 으로 온 건 PENDING 으로 정규화
        // (다른 디바이스/이전 세션에서 RUNNING 이었어도, 이 인스턴스는 그 run 의 소유자가 아니다 →
        //  새 token 으로 다시 시작해야 fencing 이 성립).
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

// ─── 영속 Store + Outbox (step-07a 와 동일) ────────────────
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

// 이전 세션 잔재 시뮬: 'x' 가 store 에 RUNNING 으로 남아 있다(앱이 도중에 죽었다고 치자).
// 부트스트랩 때 이 RUNNING 이 PENDING 으로 정규화되는 걸 보기 위해 RUNNING 으로 seed.
// 그리고 첫 upsert 1회는 실패하도록 주입.
const store = new FakeStore([{ id: 'x', status: 'RUNNING' }], 1);
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
  console.log('--- 부트스트랩: store.list() → SNAPSHOT_RECEIVED 로 흡수 (x: RUNNING→PENDING 정규화 후 drain) ---');
  const rows = await store.list();
  rt.dispatch({ kind: 'SNAPSHOT_RECEIVED', rows });

  console.log('--- 새 잡 y, z 추가 ---');
  rt.dispatch({ kind: 'ADD_TIMER', id: 'y' });
  rt.dispatch({ kind: 'ADD_TIMER', id: 'z' });

  await new Promise((r) => setTimeout(r, 1500));

  console.log('--- 최종 상태 (메모리 = 서버 로 수렴) ---');
  console.log('memory :', summary(rt.getState()));
  console.log('store  :', store.inspect().map((s) => `${s.id}=${s.status}`).join(', '));
}

void main();

// ─── 종합 출력 (실행으로 검증) ──────────────────────────────
// --- 부트스트랩: store.list() → SNAPSHOT_RECEIVED 로 흡수 (x: RUNNING→PENDING 정규화 후 drain) ---
// [state] x=RUNNING                          ← x 를 PENDING 으로 받아 같은 reduce 안에서 drain→RUNNING.
//                                               (RUNNING→PENDING 정규화는 reduce 내부 한 틱이라 별도 줄로는 안 보인다)
// --- 새 잡 y, z 추가 ---
// [state] x=RUNNING, y=RUNNING               ← 슬롯 가득 (max=2)
// [state] x=RUNNING, y=RUNNING, z=PENDING    ← z 대기
// [outbox] retry x attempt=1 after 50ms: store upsert failed (left=0)   ← x 의 RUNNING 영속이 1회 실패 → 재시도
// [state] x=DONE, y=RUNNING, z=RUNNING       ← x 완료 → z 승격
// [state] x=DONE, y=DONE, z=RUNNING          ← y 완료
// [state] x=DONE, y=DONE, z=DONE             ← z 완료
// --- 최종 상태 (메모리 = 서버 로 수렴) ---
// memory : x=DONE, y=DONE, z=DONE
// store  : x=DONE, y=DONE, z=DONE            ← 복원 + 영속 재시도 후 양쪽 일치
