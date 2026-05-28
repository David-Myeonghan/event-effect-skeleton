// Runtime — Reducer 와 Effect Interpreter 를 잇는 셸.
//
// 책임:
//  - dispatch(event) 를 직렬 처리 (single-writer)
//  - reducer 가 산출한 effect 를 interpreter 로 흘려보내기 (fire-and-forget)
//  - 상태 변화 구독 통지
//
// 비의도:
//  - effect 실행 결과로 상태가 바뀌지 않는다. 결과를 상태에 반영하려면
//    interpreter 가 `dispatch(event)` 콜백으로 새 Event 를 발행해야 한다.
//  - effect 실패가 reducer 상태를 rollback 하지 않는다 (eventual consistency).

import type {
  DomainEffect,
  DomainEvent,
  EffectInterpreter,
  Reducer,
  StateListener,
} from './types.js';

export class Runtime<
  TState,
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> {
  private state: TState;
  private readonly listeners = new Set<StateListener<TState>>();
  private disposed = false;

  constructor(
    initial: TState,
    private readonly reducer: Reducer<TState, TEvent, TEffect>,
    private readonly interpreter: EffectInterpreter<TEvent, TEffect>,
  ) {
    this.state = initial;
  }

  getState(): TState {
    return this.state;
  }

  dispatch(event: TEvent): void {
    if (this.disposed) return;
    // 1) 순수 reduce — 동기, IO 없음.
    const { state, effects } = this.reducer(this.state, event);
    this.state = state;
    // 2) 통지 — 구독자가 새 상태 본다 (effect 실행 전).
    for (const listener of this.listeners) listener(state);
    // 3) effect 실행 — fire-and-forget. 결과는 새 event 로 들어옴.
    const reentrantDispatch = (e: TEvent): void => this.dispatch(e);
    for (const effect of effects) {
      try {
        const result = this.interpreter.run(effect, reentrantDispatch);
        if (result instanceof Promise) {
          result.catch((err: unknown) => {
            // best-effort: effect 실행 실패는 로그만. reducer 상태는 그대로.
            // 실제 시스템에선 별도 onEffectError 콜백으로 노출.
            console.error('[Runtime] effect error', effect, err);
          });
        }
      } catch (err) {
        console.error('[Runtime] effect throw', effect, err);
      }
    }
  }

  subscribe(listener: StateListener<TState>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
