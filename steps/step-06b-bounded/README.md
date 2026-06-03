# Step 06b — Bounded pool (동시 실행 한도 · drain)

## 추가된 개념 (step-06a 대비)
**최대 N개만 동시 RUNNING, 나머지는 PENDING 대기.** 슬롯이 비면 다음 PENDING 후보를 자동 승격(drain).

step-06a 는 ADD_TIMER 즉시 RUNNING 이었다. 여기에 딱 세 가지만 더한다:
1. `status` 에 **PENDING** 추가
2. State 에 **maxConcurrent** + **order**(투입 순서)
3. **drain()** — 빈 슬롯 수만큼 PENDING → RUNNING 승격

## 왜 필요한가
한꺼번에 10개가 들어와도 자원은 한정돼 있어 동시 실행 한도가 필요하다. 그리고 한도가 비면 즉시 다음 작업을 시작해야 한다(놀리지 않게).

## 핵심 아이디어
- ADD_TIMER → 일단 **PENDING** 으로 넣고 `drain` 에게 맡긴다 (06a 처럼 곧장 RUNNING 안 함).
- `drain` 은 `maxConcurrent - (현재 RUNNING 수)` 만큼만 PENDING 을 끌어올린다.
- ADD_TIMER 와 TIMER_FINISHED **둘 다** drain 을 호출 — 적재 시점·완료 시점 모두 슬롯을 채운다.

```ts
function drain(state, issueToken) {
  const free = state.maxConcurrent - count(RUNNING);
  const candidates = pickPending(state.order, limit = free);
  // candidates 를 RUNNING 으로 + 각각 SCHEDULE_TIMER effect 발행
}
```

본 레포 `src/scheduler/pool.ts` 의 helper(`availableSlots` · `selectNextCandidates`) 가 같은 일을 한다.

## 실행
```bash
pnpm tsx steps/step-06b-bounded/main.ts
```

기대 출력 (실행으로 검증, maxConcurrent=2):
```
--- 4개 타이머 적재 (maxConcurrent=2) ---
[state] a=RUNNING
[state] a=RUNNING, b=RUNNING
[state] a=RUNNING, b=RUNNING, c=PENDING
[state] a=RUNNING, b=RUNNING, c=PENDING, d=PENDING
[state] a=DONE, b=RUNNING, c=RUNNING, d=PENDING
[state] a=DONE, b=DONE, c=RUNNING, d=RUNNING
[state] a=DONE, b=DONE, c=DONE, d=RUNNING
[state] a=DONE, b=DONE, c=DONE, d=DONE
```

## 다음 step
지금은 상태가 메모리에만 있다 — 앱을 끄면 다 사라지고 서버에도 안 가 있다. **영속화** 와 **재시작 후 복원** 이 마지막 조각:
- **step-07a-outbox** — 영속(서버 저장) + 실패 시 backoff 재시도
- **step-07b-reconcile** — 시작 시 서버 상태 흡수(복원)
