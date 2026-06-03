// step-04-async-result — Interpreter 가 비동기 결과를 새 Event 로 돌려준다.
//
// 도메인: 1초짜리 타이머.
//   START_TIMER → SCHEDULE_TIMER effect → setTimeout → TIMER_FINISHED event → state 갱신.
//
// step-03 과 다른 점:
//   - Interpreter 가 (effect, dispatch) 시그니처 (dispatch 콜백 받음)
//   - 비동기 작업 결과도 도메인 입구(=event) 로 들어온다 → 단방향 유지.

type State = { active: boolean };

type Event = { kind: 'START_TIMER' } | { kind: 'TIMER_FINISHED' };

type Effect = { kind: 'SCHEDULE_TIMER'; ms: number };

type ReduceResult = { state: State; effects: Effect[] };

function reduce(state: State, event: Event): ReduceResult {
  switch (event.kind) {
    case 'START_TIMER':
      if (state.active) return { state, effects: [] }; // 이미 돌고 있으면 무시
      return { state: { active: true }, effects: [{ kind: 'SCHEDULE_TIMER', ms: 1000 }] };
    case 'TIMER_FINISHED':
      return { state: { active: false }, effects: [] };
  }
}

type Interpreter<TEffect, TEvent> = (
  effect: TEffect,
  dispatch: (event: TEvent) => void,
) => void;

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

  getState(): TState {
    return this.state;
  }

  dispatch(event: TEvent): void {
    const { state, effects } = this.reducer(this.state, event);
    this.state = state;
    for (const l of this.listeners) l(state);
    for (const effect of effects) {
      // dispatch 콜백을 넘겨, interpreter 가 비동기 결과를 새 event 로 도메인에 들여보낼 수 있게.
      this.interpreter(effect, (e) => this.dispatch(e));
    }
  }

  subscribe(listener: (s: TState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const interpret: Interpreter<Effect, Event> = (effect, dispatch) => {
  if (effect.kind === 'SCHEDULE_TIMER') {
    console.log(`[effect] schedule timer in ${effect.ms}ms`);
    // 출력: [effect] schedule timer in 1000ms
    setTimeout(() => dispatch({ kind: 'TIMER_FINISHED' }), effect.ms);
  }
};

// ─── 사용 예 ──────────────────────────────────────────────
const rt = new Runtime<State, Event, Effect>({ active: false }, reduce, interpret);
rt.subscribe((s) => console.log(`[state] active=${s.active}`));
// dispatch 마다 자동 호출 → [state] active=true / active=false

rt.dispatch({ kind: 'START_TIMER' });
// 즉시:
//   1) listener     → 출력: [state] active=true
//   2) interpreter  → 출력: [effect] schedule timer in 1000ms   (+ 1초 setTimeout 예약)
// 1초 후 dispatch(TIMER_FINISHED) 가 자동 발생:
//   3) listener     → 출력: [state] active=false
// Node 는 setTimeout 이 끝나야 프로세스를 종료한다.
//
// ─── 종합 출력 ────────────────────────────────────────────
// [state] active=true
// [effect] schedule timer in 1000ms
// [state] active=false        ← 1초 뒤, 비동기 결과가 event 로 돌아와 reducer 를 통과한 결과
