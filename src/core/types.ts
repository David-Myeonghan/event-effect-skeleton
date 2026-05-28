// Core types — Event / Effect / Reducer / Interpreter
//
// 일반화된 뼈대의 골격 타입. 도메인은 이 제네릭을 채워서 자기 시스템을 만든다.
// 의존 방향: 도메인 코어는 이 파일만 import 한다. IO/UI 의존 없음.

/** 모든 입력은 `kind`로 식별되는 단일 Event 스트림으로 정규화된다. */
export interface DomainEvent<TKind extends string = string> {
  readonly kind: TKind;
}

/** 부수효과는 "할 일을 적은 데이터"다. 실행은 Interpreter 책임. */
export interface DomainEffect<TKind extends string = string> {
  readonly kind: TKind;
}

/** Reducer 결과 — 새 상태 + 발행할 effect 들. */
export interface ReducerResult<TState, TEffect extends DomainEffect> {
  readonly state: TState;
  readonly effects: readonly TEffect[];
}

/**
 * Pure Reducer — IO 없음, 같은 입력이면 같은 출력.
 * 동시 변경을 한 줄로 직렬화하는 single-writer 의 핵심.
 */
export type Reducer<
  TState,
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> = (state: TState, event: TEvent) => ReducerResult<TState, TEffect>;

/**
 * Effect Interpreter — effect 를 실제 IO 로 수행.
 * 수행 결과를 다시 도메인으로 들여보낼 때는 `dispatch` 콜백으로 새 Event 를 발행한다.
 * (Effect 안에 직접 state 를 건드리지 않는다 — 단방향 유지.)
 */
export interface EffectInterpreter<
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> {
  run(effect: TEffect, dispatch: (event: TEvent) => void): void | Promise<void>;
}

/** 상태 구독 콜백. */
export type StateListener<TState> = (state: TState) => void;
