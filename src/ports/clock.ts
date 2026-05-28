// Port — 시간. 테스트에서 결정적 시간을 주입할 수 있게 추상화.

export interface Clock {
  now(): number;
}
