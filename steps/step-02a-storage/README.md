# Step 02a — Storage (state 들고 + dispatch 만)

## 추가된 개념 (step-01 대비)
state 를 **인스턴스가 들고 있는 "통"** 으로 만든다. dispatch 한 번이면 통 안에서 reducer 가 돌고 state 가 갱신된다.

step-01 에서는 사용 측이 `let s = …; s = reduce(s, …)` 처럼 변수 재할당을 직접 했다. 통(class) 안으로 옮기면 사용 측은 `storage.dispatch(e)` 한 줄만 부르면 된다.

## 왜 이걸 별도 step 으로 떼는가
다음 단계(`step-02b` 옵저버) 와 합쳐서 우리가 step-02c 에서 보는 **Runtime** 이 된다. 두 개념을 한꺼번에 보면 정신없어서 따로 본다.

## 핵심
```ts
class Storage<TState, TEvent> {
  private state: TState;
  constructor(initial, reducer) { ... }
  getState(): TState
  dispatch(event: TEvent): void   // state = reducer(state, event)
}
```
이게 전부. listener 도, effect 도 없다.

## 이 단계의 한계 (다음 step 으로 가는 동기)
"상태가 바뀐 걸 외부에서 어떻게 알지?" — 매번 `getState()` 로 직접 확인해야 한다. UI 가 상태 바뀔 때마다 다시 그리려면 이게 너무 번거롭다.
→ **step-02b 에서 "값이 바뀔 때 알려주는" 패턴 (옵저버)** 을 따로 배운다.

## 실행
```bash
pnpm tsx steps/step-02a-storage/main.ts
```
