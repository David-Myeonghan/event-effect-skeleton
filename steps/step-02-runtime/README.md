# Step 02 — Runtime (dispatch + subscribe)

## 추가된 개념 (step-01 대비)
**Runtime** = state 를 들고 있다가 `dispatch(event)` 를 받으면 reducer 를 호출해 새 state 로 바꾸고, **구독자에게 통지**해주는 작은 셸.

## 왜 필요한가
step-01 에서는 매번 `state = reduce(state, event)` 를 손으로 적었고, "상태 바뀌면 어딘가 알리기" 도 못 했습니다. Runtime 을 두면:
- state 보관소가 한 곳
- `subscribe(callback)` 으로 변화 알림 (UI 가 여기 붙는다)
- 모든 dispatch 가 한 곳을 통과 → **single-writer**

## 핵심
```ts
class Runtime {
  dispatch(event) {
    this.state = this.reducer(this.state, event);
    this.listeners.forEach(l => l(this.state));
  }
}
```
단순하지만 본 레포 `src/core/runtime.ts` 의 뼈대.

## 실행
```bash
pnpm tsx steps/step-02-runtime/main.ts
```

## 다음 step
지금까지 reducer 는 **순수** 했습니다. 그런데 "상태 변경 + 외부에 무언가 알림(로깅·API 호출)" 같은 부수효과는 어떻게 표현할까? reducer 안에서 `console.log` 하면 순수성이 깨집니다 → **step-03-effects** 에서 effect-as-data 패턴으로 해결.
