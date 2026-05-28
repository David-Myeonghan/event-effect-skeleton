// step-02c-subscribe — Runtime = step-02a Storage + step-02b Observer 합본.
//
// step-02a 와 비교: 거기 있던 Storage 클래스 + subscribe/unsubscribe 가 추가됐다.
// step-02b 와 비교: Subject 의 set(value) 자리에 dispatch(event)→reducer 가 들어갔다.
// 합치고 나면:
//   - dispatch 한 번에 reducer 가 안전하게 state 를 바꾸고 (02a 부분)
//   - 등록된 모든 listener 가 새 state 를 들고 자동 호출된다 (02b 부분).

type State = {
  on: boolean;
  toggleCount: number;
};

type Event = { kind: 'TOGGLE' } | { kind: 'TURN_ON' } | { kind: 'TURN_OFF' };

function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case 'TOGGLE':
      return { on: !state.on, toggleCount: state.toggleCount + 1 };
    case 'TURN_ON':
      return { on: true, toggleCount: state.toggleCount };
    case 'TURN_OFF':
      return { on: false, toggleCount: state.toggleCount };
  }
}

class Runtime<TState, TEvent> {
  private state: TState;
  private readonly listeners = new Set<(state: TState) => void>();

  constructor(
    initial: TState,
    private readonly reducer: (state: TState, event: TEvent) => TState,
  ) {
    this.state = initial;
  }

  getState(): TState {
    return this.state;
  }

  dispatch(event: TEvent): void {
    this.state = this.reducer(this.state, event);
    for (const l of this.listeners) l(this.state);
  }

  subscribe(listener: (state: TState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ─── 사용 예 ──────────────────────────────────────────────
// 흐름: subscribe 로 listener 등록 → dispatch 마다 listener 자동 호출
//      → 끝나면 unsubscribe 로 정리 → getState 로 마지막 상태 직접 조회.
//
// 핵심: 우리는 listener 를 직접 부르지 않는다. 한 번 등록만 해두면 Runtime 이
// dispatch 가 일어날 때마다 *알아서* 호출한다 (옵저버 패턴 — 신문 구독과 같다).

const rt = new Runtime<State, Event>({ on: false, toggleCount: 0 }, reduce);
// 초기 state = { on: false, toggleCount: 0 }  ← 아직 dispatch 전이라 출력 없음.

const unsubscribe = rt.subscribe((s) => {
  console.log(`[state] on=${s.on}, toggleCount=${s.toggleCount}`);
});
// listener 가 Runtime 내부 listeners 집합에 등록만 됐다. 콜백은 아직 호출되지 않음.

rt.dispatch({ kind: 'TURN_ON' });
//  reducer → { on:true, toggleCount:0 } (TURN_ON 은 count 안 올림)
//  listener 자동 호출 → 출력: [state] on=true, toggleCount=0

rt.dispatch({ kind: 'TOGGLE' });
//  reducer → { on:false, toggleCount:1 }
//  출력: [state] on=false, toggleCount=1

rt.dispatch({ kind: 'TOGGLE' });
//  reducer → { on:true, toggleCount:2 }
//  출력: [state] on=true, toggleCount=2

rt.dispatch({ kind: 'TURN_OFF' });
//  reducer → { on:false, toggleCount:2 } (TURN_OFF 는 count 그대로)
//  출력: [state] on=false, toggleCount=2

unsubscribe();
// listener 가 listeners 집합에서 빠짐. 이 줄 이후의 dispatch 는 우리 콜백을 호출하지 않는다.
// (여기선 더 이상 dispatch 안 하지만, 실 앱에서는 컴포넌트 unmount 시 호출 — 구독 누수 방지.)

console.log('final:', rt.getState());
// 출력: final: { on: false, toggleCount: 2 }
// getState 는 listener 와 무관 — 그냥 Runtime 이 보관 중인 현재 state 를 동기로 꺼낸다.

// ─── 종합 출력 ────────────────────────────────────────────
// [state] on=true, toggleCount=0      ← TURN_ON
// [state] on=false, toggleCount=1     ← TOGGLE #1
// [state] on=true, toggleCount=2      ← TOGGLE #2
// [state] on=false, toggleCount=2     ← TURN_OFF
// final: { on: false, toggleCount: 2 } ← unsubscribe 후 getState 직접 조회
