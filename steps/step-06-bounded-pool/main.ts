// step-06-bounded-pool — 여러 작업 동시 실행, 최대 N 개 + drain.
//
// step-05 와 다른 점:
//   - State 가 여러 타이머를 보관(Map). status: PENDING / RUNNING / DONE.
//   - drain() 가 빈 슬롯 만큼 PENDING 을 RUNNING 으로 승격하고 effect 발행.
//   - ADD_TIMER · TIMER_FINISHED 둘 다 drain 을 호출해 슬롯 채움.

type TimerStatus = 'PENDING' | 'RUNNING' | 'DONE';
interface Timer {
  id: string;
  status: TimerStatus;
  token: number | null;
}
interface State {
  timers: ReadonlyMap<string, Timer>;
  order: readonly string[];
  maxConcurrent: number;
}

type Event =
  | { kind: 'ADD_TIMER'; id: string }
  | { kind: 'TIMER_FINISHED'; id: string; token: number };

type Effect = { kind: 'SCHEDULE_TIMER'; id: string; token: number; ms: number };
type ReduceResult = { state: State; effects: Effect[] };

// ─── drain — slot 여유 만큼 PENDING 을 RUNNING 으로 승격 ─────────
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
        return drain(next, issueToken);
      }
      case 'TIMER_FINISHED': {
        const t = state.timers.get(event.id);
        if (!t) return { state, effects: [] };
        if (t.token !== event.token) {
          console.log(`[reducer] stale result for ${event.id} token=${event.token} — ignored`);
          return { state, effects: [] };
        }
        const next: State = {
          ...state,
          timers: new Map(state.timers).set(event.id, { ...t, status: 'DONE', token: null }),
        };
        return drain(next, issueToken);
      }
    }
  };
}

// ─── Runtime + Interpreter (step-05 와 동일 구조) ──────────────────
type Interpreter<TEffect, TEvent> = (e: TEffect, dispatch: (e: TEvent) => void) => void;

class Runtime<TState, TEvent, TEffect> {
  private state: TState;
  private readonly listeners = new Set<(s: TState) => void>();
  constructor(
    initial: TState,
    private readonly reducer: (s: TState, e: TEvent) => { state: TState; effects: TEffect[] },
    private readonly interpreter: Interpreter<TEffect, TEvent>,
  ) {
    this.state = initial;
  }
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

const interpret: Interpreter<Effect, Event> = (effect, dispatch) => {
  if (effect.kind === 'SCHEDULE_TIMER') {
    setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', id: effect.id, token: effect.token }), effect.ms);
  }
};

// ─── 사용 예 ──────────────────────────────────────────────
let tokenSeq = 0;
const reduce = createReducer(() => (tokenSeq += 1));

const initial: State = { timers: new Map(), order: [], maxConcurrent: 2 };
const rt = new Runtime<State, Event, Effect>(initial, reduce, interpret);

const summary = (s: State): string =>
  Array.from(s.timers.values())
    .map((t) => `${t.id}=${t.status}`)
    .join(', ');

rt.subscribe((s) => console.log(`[state] ${summary(s)}`));

console.log('--- 4개 타이머 적재 (maxConcurrent=2) ---');
rt.dispatch({ kind: 'ADD_TIMER', id: 'a' });
rt.dispatch({ kind: 'ADD_TIMER', id: 'b' });
rt.dispatch({ kind: 'ADD_TIMER', id: 'c' }); // PENDING — slot 가득
rt.dispatch({ kind: 'ADD_TIMER', id: 'd' }); // PENDING

// 500ms 후 a,b 끝남 → drain → c,d RUNNING. 다시 500ms 후 모두 DONE.
