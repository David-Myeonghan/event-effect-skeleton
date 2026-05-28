// step-02-runtime — Runtime 셸 추가.
//
// step-01 과 다른 점:
//   - state 를 직접 들고 다니지 않는다. Runtime 인스턴스가 보관.
//   - subscribe(cb) 로 변화 알림 (UI 가 붙는 자리).
//   - dispatch(event) 한 곳을 통과 → single-writer.

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
const rt = new Runtime<State, Event>({ on: false, toggleCount: 0 }, reduce);

const unsubscribe = rt.subscribe((s) => {
  console.log(`[state] on=${s.on}, toggleCount=${s.toggleCount}`);
});

rt.dispatch({ kind: 'TURN_ON' });
rt.dispatch({ kind: 'TOGGLE' });
rt.dispatch({ kind: 'TOGGLE' });
rt.dispatch({ kind: 'TURN_OFF' });

unsubscribe();
console.log('final:', rt.getState());
