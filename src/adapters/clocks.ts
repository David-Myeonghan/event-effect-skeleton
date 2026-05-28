// Adapter — Real / Fake Clock.
//   - RealClock: Date.now() 그대로
//   - FakeClock: 테스트에서 시간을 결정적으로 흘려보낸다.

import type { Clock } from '../ports/clock.js';

export class RealClock implements Clock {
  now(): number {
    return Date.now();
  }
}

export class FakeClock implements Clock {
  private t: number;
  constructor(initial = 0) {
    this.t = initial;
  }
  now(): number {
    return this.t;
  }
  advance(ms: number): void {
    this.t += ms;
  }
  setTo(ms: number): void {
    this.t = ms;
  }
}
