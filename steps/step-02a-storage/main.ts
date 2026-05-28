// step-02a-storage — Runtime 의 가장 작은 형태.
//
// state 를 "통(class)" 이 들고 있고, dispatch(event) 한 번에 reducer 가 돌아
// state 가 갱신된다. listener 도, effect 도 없다 — 진짜 storage 만.

type State = { count: number };
type Event = { kind: 'INC' } | { kind: 'DEC' };

function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case 'INC':
      return { count: state.count + 1 };
    case 'DEC':
      return { count: state.count - 1 };
  }
}

class Storage<TState, TEvent> {
  private state: TState;
  constructor(
    initial: TState,
    private readonly reducer: (s: TState, e: TEvent) => TState,
  ) {
    this.state = initial;
  }

  getState(): TState {
    return this.state;
  }

  dispatch(event: TEvent): void {
    this.state = this.reducer(this.state, event);
  }
}

// ─── 사용 예 ──────────────────────────────────────────────
// listener 가 없어서, 상태가 바뀐 걸 보려면 매번 getState() 로 *직접* 확인해야 한다.

const store = new Storage<State, Event>({ count: 0 }, reduce);

console.log('초기 :', store.getState());          // 출력: 초기 : { count: 0 }

store.dispatch({ kind: 'INC' });
console.log('INC 후:', store.getState());         // 출력: INC 후: { count: 1 }

store.dispatch({ kind: 'INC' });
console.log('INC 후:', store.getState());         // 출력: INC 후: { count: 2 }

store.dispatch({ kind: 'DEC' });
console.log('DEC 후:', store.getState());         // 출력: DEC 후: { count: 1 }

// ☝ 한계: 상태 바뀐 걸 알려면 매번 위처럼 getState() 를 "물어봐야" 한다.
//   UI 가 자동으로 따라가려면 "값이 바뀔 때 자동으로 알려주는" 장치가 필요하다.
//   → step-02b 옵저버 패턴.
