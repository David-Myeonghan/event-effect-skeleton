// HandlerMapInterpreter — effect.kind 로 분기하는 핸들러 맵 기반 Interpreter.
//
// 도메인은 effect 종류별로 핸들러를 등록하면 된다. 핸들러 안에서 IO 를 수행하고,
// 결과로 새 Event 가 필요하면 dispatch 콜백을 부른다 (단방향 유지).

import type { DomainEffect, DomainEvent, EffectInterpreter } from '../core/types.js';

export type EffectHandler<
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> = (effect: TEffect, dispatch: (event: TEvent) => void) => void | Promise<void>;

export type EffectHandlerMap<
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> = Partial<Record<TEffect['kind'], EffectHandler<TEvent, TEffect>>>;

export class HandlerMapInterpreter<
  TEvent extends DomainEvent,
  TEffect extends DomainEffect,
> implements EffectInterpreter<TEvent, TEffect>
{
  constructor(private readonly handlers: EffectHandlerMap<TEvent, TEffect>) {}

  run(effect: TEffect, dispatch: (event: TEvent) => void): void | Promise<void> {
    const handler = this.handlers[effect.kind as TEffect['kind']];
    if (!handler) {
      console.warn(`[HandlerMapInterpreter] no handler for effect kind: ${effect.kind}`);
      return;
    }
    return handler(effect, dispatch);
  }
}
