// step-05-fencing — 취소 후 늦게 도착한 결과를 fencing token 으로 폐기.
//
// step-04 와 다른 점:
//   - State 에 currentToken 추가
//   - START_TIMER 시 token 발급, SCHEDULE_TIMER effect / TIMER_FINISHED event 에 동봉
//   - reducer 가 TIMER_FINISHED 의 token 을 검증 (stale 이면 무시)
//   - token 발급은 외부 주입 (reducer 의 순수성 유지)
//   - stale 알림조차 reducer 가 직접 console.log 하지 않고 LOG effect 로 내보낸다
//     (step-03 의 규칙: "reducer 안에서 IO 금지" 를 끝까지 지킨다)

type State = {
  active: boolean;
  currentToken: number | null;
};

type Event =
  | { kind: 'START_TIMER' }
  | { kind: 'CANCEL_TIMER' }
  | { kind: 'TIMER_FINISHED'; token: number };

// SCHEDULE_TIMER = 비동기 작업 예약, LOG = 진단 출력. 둘 다 "할 일 데이터" 일 뿐.
type Effect =
  | { kind: 'SCHEDULE_TIMER'; token: number; ms: number }
  | { kind: 'LOG'; message: string };

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
          // 다른 작업의 늦은 결과 — 폐기 (state 변경 없음).
          // reducer 는 IO 를 하지 않으므로 로그도 effect 로 "요청" 만 한다.
          return { state, effects: [{ kind: 'LOG', message: `stale result for token=${event.token} — ignored` }] };
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
    // ★ 주의: state 가 "안 바뀌어도" dispatch 마다 listener 는 무조건 호출된다.
    //   이 Runtime 은 이전 state 와 비교(Object.is 등)해서 통지를 건너뛰지 않는다.
    //   그래서 stale 한 TIMER_FINISHED(=no-op) 가 와도 아래 listener 가 한 번 더 찍힌다.
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
      console.log(`[effect] schedule timer in ${effect.ms}ms (token=${effect.token})`);
      // 출력: [effect] schedule timer in 1000ms (token=1)
      setTimeout(() => dispatch({ kind: 'TIMER_FINISHED', token: effect.token }), effect.ms);
      return;
    case 'LOG':
      console.log(`[effect] ${effect.message}`);
      // 출력(stale 시): [effect] stale result for token=1 — ignored
      return;
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
// reducer → { active:true, currentToken:1 }, effects=[SCHEDULE_TIMER token=1]
//   1) listener 자동 호출  → 출력: [state] active=true (token=1)
//   2) interpreter 실행     → 출력: [effect] schedule timer in 1000ms (token=1)  (+ setTimeout 1000ms 예약)

setTimeout(() => {
  console.log('--- 200ms 뒤 사용자가 취소 ---');
  // 출력: --- 200ms 뒤 사용자가 취소 ---
  rt.dispatch({ kind: 'CANCEL_TIMER' });
  // reducer → { active:false, currentToken:null }, effects=[]
  //   listener 자동 호출 → 출력: [state] active=false (cancelled)
}, 200);

// 1초 뒤 예약돼 있던 TIMER_FINISHED(token=1) 가 도착하지만 currentToken 은 이미 null → stale.
//   reducer 는 state 를 안 바꾸고 LOG effect 만 낸다. 그래도 dispatch 라서:
//     1) listener 가 또 호출됨(no-op 인데도!) → 출력: [state] active=false (cancelled)
//     2) LOG effect 실행                        → 출력: [effect] stale result for token=1 — ignored
//
// ─── 종합 출력 (순서대로) ──────────────────────────────────
// [state] active=true (token=1)
// [effect] schedule timer in 1000ms (token=1)
// --- 200ms 뒤 사용자가 취소 ---
// [state] active=false (cancelled)
// [state] active=false (cancelled)      ← stale TIMER_FINISHED 의 no-op 통지 (★ 위 dispatch 주석 참고)
// [effect] stale result for token=1 — ignored
