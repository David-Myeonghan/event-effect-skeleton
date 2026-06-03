// step-06a-multi — 타이머를 "여러 개" 동시에 굴린다 (동시 실행 한도 없음).
//
// step-05 와 다른 점 (이것만 추가):
//   - State 가 타이머 1개(스칼라)에서 → 여러 개(Map) 로 바뀐다.
//   - 각 타이머가 자기 token 을 갖는다 (fencing 은 05 그대로, id 별로).
//   - ADD_TIMER 마다 그 자리에서 바로 RUNNING + SCHEDULE_TIMER (대기/슬롯 개념 없음).
//
// 아직 "최대 N개 제한" 은 없다 — 그건 step-06b 에서. 여기선 "다중 상태" 만 본다.

type TimerStatus = 'RUNNING' | 'DONE';
interface Timer {
  id: string;
  status: TimerStatus;
  token: number | null;
}
interface State {
  timers: ReadonlyMap<string, Timer>;
}

type Event =
  | { kind: 'ADD_TIMER'; id: string }
  | { kind: 'TIMER_FINISHED'; id: string; token: number };

type Effect =
  | { kind: 'SCHEDULE_TIMER'; id: string; token: number; ms: number }
  | { kind: 'LOG'; message: string };
type ReduceResult = { state: State; effects: Effect[] };

function createReducer(issueToken: () => number) {
  return function reduce(state: State, event: Event): ReduceResult {
    switch (event.kind) {
      case 'ADD_TIMER': {
        if (state.timers.has(event.id)) return { state, effects: [] };
        // 한도가 없으니 추가하자마자 곧장 RUNNING 으로 시작.
        const token = issueToken();
        const timer: Timer = { id: event.id, status: 'RUNNING', token };
        const next: State = { timers: new Map(state.timers).set(event.id, timer) };
        return { state: next, effects: [{ kind: 'SCHEDULE_TIMER', id: event.id, token, ms: 500 }] };
      }
      case 'TIMER_FINISHED': {
        const t = state.timers.get(event.id);
        if (!t) return { state, effects: [] };
        if (t.token !== event.token) {
          // stale — reducer 는 IO 안 함, LOG effect 로만 알린다 (step-05 와 동일 규칙).
          return { state, effects: [{ kind: 'LOG', message: `stale result for ${event.id} token=${event.token} — ignored` }] };
        }
        const done: Timer = { ...t, status: 'DONE', token: null };
        return { state: { timers: new Map(state.timers).set(event.id, done) }, effects: [] };
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

const rt = new Runtime<State, Event, Effect>({ timers: new Map() }, reduce, interpret);

const summary = (s: State): string =>
  Array.from(s.timers.values()).map((t) => `${t.id}=${t.status}`).join(', ');

rt.subscribe((s) => console.log(`[state] ${summary(s)}`));

console.log('--- 3개 타이머 적재 (한도 없음 → 셋 다 즉시 RUNNING) ---');
// 출력: --- 3개 타이머 적재 (한도 없음 → 셋 다 즉시 RUNNING) ---
rt.dispatch({ kind: 'ADD_TIMER', id: 'a' });
// 출력: [state] a=RUNNING
rt.dispatch({ kind: 'ADD_TIMER', id: 'b' });
// 출력: [state] a=RUNNING, b=RUNNING
rt.dispatch({ kind: 'ADD_TIMER', id: 'c' });
// 출력: [state] a=RUNNING, b=RUNNING, c=RUNNING

// 500ms 후 a,b,c 의 TIMER_FINISHED 가 (예약된 순서대로) 도착 → 차례로 DONE.
//   출력: [state] a=DONE, b=RUNNING, c=RUNNING
//   출력: [state] a=DONE, b=DONE, c=RUNNING
//   출력: [state] a=DONE, b=DONE, c=DONE
//
// ─── 종합 출력 ────────────────────────────────────────────
// --- 3개 타이머 적재 (한도 없음 → 셋 다 즉시 RUNNING) ---
// [state] a=RUNNING
// [state] a=RUNNING, b=RUNNING
// [state] a=RUNNING, b=RUNNING, c=RUNNING
// [state] a=DONE, b=RUNNING, c=RUNNING
// [state] a=DONE, b=DONE, c=RUNNING
// [state] a=DONE, b=DONE, c=DONE
