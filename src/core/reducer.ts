// Reducer helpers — Reducer 작성 편의 함수.

import type { DomainEffect, ReducerResult } from './types.js';

/** 상태만 바꾸고 effect 는 없는 결과. */
export function pureState<TState, TEffect extends DomainEffect>(
  state: TState,
): ReducerResult<TState, TEffect> {
  return { state, effects: [] };
}

/** 상태 + 단일 effect. */
export function withEffect<TState, TEffect extends DomainEffect>(
  state: TState,
  effect: TEffect,
): ReducerResult<TState, TEffect> {
  return { state, effects: [effect] };
}

/** 상태 + 여러 effect. */
export function withEffects<TState, TEffect extends DomainEffect>(
  state: TState,
  effects: readonly TEffect[],
): ReducerResult<TState, TEffect> {
  return { state, effects };
}

/** event 를 무시(상태 변경 없음, effect 없음) — stale event 등. */
export function ignore<TState, TEffect extends DomainEffect>(
  state: TState,
): ReducerResult<TState, TEffect> {
  return { state, effects: [] };
}
