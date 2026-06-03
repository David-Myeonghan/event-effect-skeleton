// Reducer helpers — Reducer 작성 편의 함수.

import type { DomainEffect, ReducerResult } from './types.js';

/** 상태만 바꾸고 effect 는 없는 결과. */
export function pureState<TState, TEffect extends DomainEffect>(
  state: TState,
): ReducerResult<TState, TEffect> {
  return { state, effects: [] };
}

/** 상태 + 여러 effect. (effect 1개면 `withEffects(state, [e])`.) */
export function withEffects<TState, TEffect extends DomainEffect>(
  state: TState,
  effects: readonly TEffect[],
): ReducerResult<TState, TEffect> {
  return { state, effects };
}
