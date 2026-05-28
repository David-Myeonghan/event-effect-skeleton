// step-05-fencing — 취소 후 늦게 도착한 결과를 fencing token 으로 폐기.
//
// step-04 와 다른 점:
//   - State 에 currentToken 추가
//   - START_TIMER 시 token 발급, SCHEDULE_TIMER effect / TIMER_FINISHED event 에 동봉
//   - reducer 가 TIMER_FINISHED 의 token 을 검증 (stale 이면 무시)
//   - token 발급은 외부 주입 (reducer 의 순수성 유지)

type State = {
  active: boolean;
  currentToken: number | null;
};

type Event =
  | { kind: 'START_TIMER' }
  | { kind: 'CANCEL_TIMER' }
  | { kind: 'TIMER_FINISHED'; token: number };

type Effect = { kind: 'SCHEDULE_TIMER'; token: number; ms: number };

type ReduceResult = { state: State; effects: Effect[] };

/**
 * reducer 를 함수 팩토리로 — token 발급을 외부에서 주입한다.
 * 이렇게 해야 reducer 가 호출 때마다 다른 결과를 내지 않고 "주입된 의존성에 대해 순수" 하다.
 */
function createReducer(issueToken: () => number) {
  return function reduce(state: State, event: Event): ReduceResult {
    switch (event.kind) {
      case 'START_TIMER': {
        if (state.active) return { state, effects: [] };
        const token = issueToken();
        return {
          state: { active: true, currentToken: token },
          effects: [{ kind: 'SCHEDULE_TIMER', token, ms: 1000 }],
        };
      }
      case 'CANCEL_TIMER':
        return { state: { active: false, currentToken: null }, effects: [] };
      case 'TIMER_FINISHED': {
        if (state.currentToken !== event.token) {
          // 다른 작업의 늦은 결과 — 폐기 (state 변경 없음)
          console.log(`[reducer] stale result for token=${event.token} — ignored`);
          return { state, effects: [] };
        }
        return { state: { active: false, currentToken: null }, effects: [] };
      }
    }
  };
}

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
    console.log(`[effect] schedule timer in ${effect.ms}ms (token=${effect.token})`);
    setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', token: effect.token }), effect.ms);
  }
};

// ─── 사용 예 ──────────────────────────────────────────────
let tokenSeq = 0;
const reduce = createReducer(() => (tokenSeq += 1));

const rt = new Runtime<State, Event, Effect>(
  { active: false, currentToken: null },
  reduce,
  interpret,
);
rt.subscribe((s) =>
  console.log(
    `[state] active=${s.active}${s.currentToken !== null ? ` (token=${s.currentToken})` : ' (cancelled)'}`,
  ),
);

// 시나리오: 시작 → 200ms 뒤 취소 → 1초 뒤 늦은 결과 도착 → 무시되는지 확인.
rt.dispatch({ kind: 'START_TIMER' });
setTimeout(() => {
  console.log('--- 200ms 뒤 사용자가 취소 ---');
  rt.dispatch({ kind: 'CANCEL_TIMER' });
}, 200);

// 1.2초 뒤 결과: TIMER_FINISHED(token=1) 가 도착하지만 currentToken 은 null → stale 폐기.
