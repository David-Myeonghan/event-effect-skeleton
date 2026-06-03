# Step 06a — Multi timer (여러 개 동시, 한도 없음)

## 추가된 개념 (step-05 대비)
**상태를 타이머 1개(스칼라) → 여러 개(Map) 로 확장.** 각 타이머가 자기 id·status·token 을 갖는다.

step-05 는 `active`/`currentToken` 처럼 **단 하나의 작업** 만 표현했다. 실제 큐는 여러 작업이 동시에 산다 → state 를 `Map<id, Timer>` 로 바꾸는 게 첫 걸음이다.

> 이 step 은 일부러 **동시 실행 한도를 두지 않는다.** ADD_TIMER 하면 그 자리에서 바로 RUNNING. "다중 상태" 라는 개념 하나만 떼어 보기 위함이다. 한도·대기(PENDING)·drain 은 바로 다음 **step-06b** 에서 얹는다.

## 핵심
```ts
interface State { timers: ReadonlyMap<string, Timer>; }   // ← 스칼라 → Map

case 'ADD_TIMER':
  // 한도가 없으니 추가 즉시 RUNNING + 스케줄
  return { state: withTimer(RUNNING), effects: [{ kind: 'SCHEDULE_TIMER', ... }] };
```
fencing(token 검증)은 step-05 그대로지만, 이제 **id 별로** 적용된다.

## 이 단계의 한계 (다음 step 동기)
한도가 없으면 100개가 한 번에 들어올 때 100개가 동시에 RUNNING — GPU/CPU/네트워크가 못 버틴다.
→ **step-06b** 에서 `maxConcurrent` + `drain` 으로 "최대 N개만, 나머지는 PENDING 대기" 를 도입.

## 실행
```bash
pnpm tsx steps/step-06a-multi/main.ts
```

기대 출력 (실행으로 검증):
```
--- 3개 타이머 적재 (한도 없음 → 셋 다 즉시 RUNNING) ---
[state] a=RUNNING
[state] a=RUNNING, b=RUNNING
[state] a=RUNNING, b=RUNNING, c=RUNNING
[state] a=DONE, b=RUNNING, c=RUNNING
[state] a=DONE, b=DONE, c=RUNNING
[state] a=DONE, b=DONE, c=DONE
```

## 다음 step
**step-06b-bounded** — 동시 실행 한도 + drain.
