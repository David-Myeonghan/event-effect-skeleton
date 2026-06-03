// step-06b-bounded — step-06a 에 "동시 실행 최대 N개" 제한 + drain 을 얹는다.
//
// step-06a 와 다른 점 (이것만 추가):
//   - status 에 PENDING 추가 (RUNNING/DONE → PENDING/RUNNING/DONE).
//   - State 에 maxConcurrent + order(투입 순서) 추가.
//   - drain() : 빈 슬롯 수만큼 PENDING 을 RUNNING 으로 승격하고 effect 발행.
//   - ADD_TIMER · TIMER_FINISHED 둘 다 drain 을 호출해 슬롯을 다시 채운다.

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

type Effect =
  | { kind: 'SCHEDULE_TIMER'; id: string; token: number; ms: number }
  | { kind: 'LOG'; message: string };
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
        // 06a 와 달리 곧장 RUNNING 이 아니라 일단 PENDING 으로 넣고 drain 에게 맡긴다.
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
          // stale — reducer 는 IO 안 함, LOG effect 로만 알린다.
          return { state, effects: [{ kind: 'LOG', message: `stale result for ${event.id} token=${event.token} — ignored` }] };
        }
        const next: State = {
          ...state,
          timers: new Map(state.timers).set(event.id, { ...t, status: 'DONE', token: null }),
        };
        // 슬롯이 하나 비었으니 drain 으로 다음 PENDING 을 끌어올린다.
        return drain(next, issueToken);
      }
    }
  };
}

// ─── Runtime + Interpreter (step-06a 와 동일 구조) ──────────────────
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
  switch (effect.kind) {
    case 'SCHEDULE_TIMER':
      setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', id: effect.id, token: effect.token }), effect.ms);
      return;
    case 'LOG':
      console.log(`[effect] ${effect.message}`);
      return;
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
// 출력: --- 4개 타이머 적재 (maxConcurrent=2) ---
rt.dispatch({ kind: 'ADD_TIMER', id: 'a' });
// 출력: [state] a=RUNNING                              (슬롯 2 중 1 사용)
rt.dispatch({ kind: 'ADD_TIMER', id: 'b' });
// 출력: [state] a=RUNNING, b=RUNNING                   (슬롯 가득)
rt.dispatch({ kind: 'ADD_TIMER', id: 'c' });
// 출력: [state] a=RUNNING, b=RUNNING, c=PENDING        (자리 없어 대기)
rt.dispatch({ kind: 'ADD_TIMER', id: 'd' });
// 출력: [state] a=RUNNING, b=RUNNING, c=PENDING, d=PENDING

// 500ms 후 a,b 끝남 → 각 완료마다 drain → c, d 가 차례로 RUNNING 승격.
//   출력: [state] a=DONE, b=RUNNING, c=RUNNING, d=PENDING   (a 완료 → c 승격)
//   출력: [state] a=DONE, b=DONE, c=RUNNING, d=RUNNING      (b 완료 → d 승격)
// 다시 500ms 후 c, d 완료.
//   출력: [state] a=DONE, b=DONE, c=DONE, d=RUNNING
//   출력: [state] a=DONE, b=DONE, c=DONE, d=DONE
//
// ─── 종합 출력 ────────────────────────────────────────────
// --- 4개 타이머 적재 (maxConcurrent=2) ---
// [state] a=RUNNING
// [state] a=RUNNING, b=RUNNING
// [state] a=RUNNING, b=RUNNING, c=PENDING
// [state] a=RUNNING, b=RUNNING, c=PENDING, d=PENDING
// [state] a=DONE, b=RUNNING, c=RUNNING, d=PENDING
// [state] a=DONE, b=DONE, c=RUNNING, d=RUNNING
// [state] a=DONE, b=DONE, c=DONE, d=RUNNING
// [state] a=DONE, b=DONE, c=DONE, d=DONE
