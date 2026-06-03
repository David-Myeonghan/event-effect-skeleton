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
    // 다른 작업의 늦은 결과 — 폐기. state 변경 없음 + 진단 로그는 effect 로만 요청.
    return { state, effects: [{ kind: 'LOG', message: `stale result for token=${event.token} — ignored` }] };
  }
  return { state: { active: false, currentToken: null }, effects: [] };
}
```
**reducer 가 순수성을 유지하기 위해 token 발급은 외부에서 주입** (`createReducer(issueToken)`). reducer 안에서 `++counter` 같은 부수효과를 만들지 않는다. stale 로그도 step-03 의 규칙대로 reducer 가 `console.log` 를 직접 하지 않고 **LOG effect** 로 내보내, Interpreter 가 실제 출력을 한다(순수성 일관 유지).

## ★ 여기서 처음 드러나는 동작: no-op dispatch 도 listener 를 호출한다
stale 한 `TIMER_FINISHED` 는 state 를 **안 바꾸는데도** 아래 출력에서 `[state] active=false (cancelled)` 가 **한 번 더** 찍힌다. 이유: 이 Runtime 의 `dispatch` 는 reduce 결과가 이전 state 와 같든 다르든 **무조건 listener 를 통지**한다(이전 state 와 `Object.is` 비교로 skip 하지 않는다). 실무 store(예: Redux/Zustand)는 보통 같은 참조면 통지를 건너뛰는데, 이 학습용 Runtime 은 단순화를 위해 항상 통지한다 — 그래서 "무시했는데 왜 또 찍히지?" 가 정상이다.

## 실행
```bash
pnpm tsx steps/step-05-fencing/main.ts
```

기대 출력 (실행으로 검증된 6줄):
```
[state] active=true (token=1)
[effect] schedule timer in 1000ms (token=1)
--- 200ms 뒤 사용자가 취소 ---
[state] active=false (cancelled)
[state] active=false (cancelled)            ← stale TIMER_FINISHED 의 no-op 통지 (위 ★ 참고)
[effect] stale result for token=1 — ignored
```

## 다음 step
지금은 타이머 **하나** 만 다룬다. 먼저 여러 개를 동시에(한도 없이) 굴려 보고(**step-06a-multi**), 그 다음 **최대 N개** 만 동시 실행하도록 slot·drain 을 얹는다(**step-06b-bounded**).
