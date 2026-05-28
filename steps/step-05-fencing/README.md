# Step 05 — Fencing token (취소 후 늦은 결과 폐기)

## 추가된 개념 (step-04 대비)
**Fencing token** — 매 비동기 작업마다 고유 토큰을 발급. 결과가 돌아올 때 현재 활성 토큰과 다르면 **stale** 로 폐기한다.

## 왜 필요한가 (step-04 의 한계)
step-04 의 시나리오를 떠올려 보자:
```
1. START_TIMER → setTimeout 1초 예약
2. (0.2초 뒤) 사용자가 취소하고 싶다 → CANCEL_TIMER event
3. (1초 뒤)   원래 예약된 TIMER_FINISHED 가 도착 → reducer 가 state 를 inactive 로 또 만듦
```
취소 후에 늦게 도착한 결과가 또 한 번 state 를 건드린다(여기선 우연히 inactive 라 무해해 보이지만, "잡 결과를 적용" 같은 경우엔 **취소된 잡이 되살아남**).

## 해결
- 시작마다 **token** 발급(`{ active: true, currentToken: t }`)
- effect 에도 token 포함: `SCHEDULE_TIMER { token, ms }`
- 결과 event 에도 token 포함: `TIMER_FINISHED { token }`
- reducer 는 도착한 token 이 현재 token 과 다르면 **그냥 무시**(state 변경 X)

이게 분산 시스템의 **fencing token** 패턴. 본 레포 `src/sync/fencing.ts` 와 batch 의 `runId` 와 같다.

## 핵심
```ts
case 'TIMER_FINISHED': {
  if (state.currentToken !== event.token) {
    // 다른 작업의 늦은 결과 — 폐기
    return { state, effects: [] };
  }
  return { state: { active: false, currentToken: null }, effects: [] };
}
```
**reducer 가 순수성을 유지하기 위해 token 발급은 외부에서 주입** (`createReducer(issueToken)`). reducer 안에서 `++counter` 같은 부수효과를 만들지 않는다.

## 실행
```bash
pnpm tsx steps/step-05-fencing/main.ts
```

기대 출력:
```
[state] active=true (token=1)
[effect] schedule timer in 1000ms (token=1)
[state] active=false (cancelled)
[reducer] stale result for token=1 — ignored
```

## 다음 step
지금은 타이머 **하나** 만 다룬다. 여러 개를 동시에 굴리되 **최대 N개** 만 동시 실행하고 싶다면? → **step-06-bounded-pool** 에서 slot 추적 + drain 도입.
