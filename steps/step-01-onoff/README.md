# Step 01 — On/Off (Pure Reducer)

## 추가된 개념
**Pure Reducer** — `(state, event) → new state` 인 함수 하나. IO 없음.

## 왜 이게 시작인가
모든 복잡한 시스템의 뼈대는 "상태가 어떻게 변하는가" 입니다. 그것을 **순수 함수**로 떼어내면:
- 같은 입력 → 같은 출력 (테스트하기 쉬움)
- 상태 변경이 한 줄에서 결정됨 (single-writer 의 씨앗)

이 step 에는 Runtime 도, Effect 도, 비동기도 없습니다. 함수 하나뿐.

## 핵심
```ts
function reduce(state: State, event: Event): State { ... }
```
사용 측은 `state = reduce(state, event)` 로 새 상태를 받습니다.

## 실행
```bash
pnpm tsx steps/step-01-onoff/main.ts
```

## 다음 step
매번 `state = reduce(...)` 를 손으로 쓰는 건 번거롭고, 상태 변화에 반응할 방법(구독)도 없습니다 → **step-02a-storage** 에서 state 를 들고 있는 "통(Storage)" 을 먼저 도입하고, 02b(옵저버)·02c(합본 Runtime) 로 이어집니다.
