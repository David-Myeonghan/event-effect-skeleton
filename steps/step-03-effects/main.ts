// step-03-effects — Effect-as-data 패턴.
//
// step-02 와 다른 점:
//   - reducer 가 (state, event) → (new state, effects[]) 를 돌려준다.
//   - effect 는 "할 일 데이터" — 실제 IO 는 Interpreter 가 수행.
//   - reducer 는 여전히 순수 (console.log 같은 IO 가 없다).

type State = { on: boolean };

type Event = { kind: 'TOGGLE' };

type Effect = { kind: 'LOG'; message: string };

type ReduceResult = {
  state: State;
  effects: Effect[];
};

function reduce(state: State, event: Event): ReduceResult {
  switch (event.kind) {
    case 'TOGGLE': {
      const next = !state.on;
      return {
        state: { on: next },
        effects: [{ kind: 'LOG', message: `toggled → ${next ? 'ON' : 'OFF'}` }],
      };
    }
  }
}

type Interpreter<TEffect> = (effect: TEffect) => void;

class Runtime<TState, TEvent, TEffect> {
  private state: TState;
  private readonly listeners = new Set<(state: TState) => void>();

  constructor(
    initial: TState,
    private readonly reducer: (s: TState, e: TEvent) => { state: TState; effects: TEffect[] },
    private readonly interpreter: Interpreter<TEffect>,
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
    for (const effect of effects) this.interpreter(effect);
  }

  subscribe(listener: (s: TState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

// ─── Interpreter — 실제 IO 가 일어나는 자리 ──────────────────
const interpret: Interpreter<Effect> = (effect) => {
  if (effect.kind === 'LOG') {
    console.log('[effect]', effect.message);
    // 출력: [effect] toggled → ON   /   [effect] toggled → OFF  (effect.message 에 따라)
  }
};

// ─── 사용 예 ──────────────────────────────────────────────
const rt = new Runtime<State, Event, Effect>({ on: false }, reduce, interpret);

rt.subscribe((s) => {
  console.log(`[state] on=${s.on}`);
  // dispatch 마다 자동 호출 → [state] on=true / [state] on=false ...
});

// dispatch 1번당 두 줄이 순서대로 찍힌다: 먼저 listener(state), 그 다음 interpreter(effect).
rt.dispatch({ kind: 'TOGGLE' });
// 출력: [state] on=true
// 출력: [effect] toggled → ON
rt.dispatch({ kind: 'TOGGLE' });
// 출력: [state] on=false
// 출력: [effect] toggled → OFF
rt.dispatch({ kind: 'TOGGLE' });
// 출력: [state] on=true
// 출력: [effect] toggled → ON

// 순수성 확인 — reducer 는 IO 없이 effect 만 반환.
const r1 = reduce({ on: false }, { kind: 'TOGGLE' });
const r2 = reduce({ on: false }, { kind: 'TOGGLE' });
console.log('reducer pure?:', JSON.stringify(r1) === JSON.stringify(r2));
// 출력: reducer pure?: true
//   ★ reduce 를 두 번 호출해도 console.log 가 안 찍힌다 — IO 가 reducer 밖(interpreter)에 있기 때문.
//     step-02 처럼 reducer 안에서 로그를 찍었다면 이 두 줄에서 [effect] 가 또 나왔을 것.
