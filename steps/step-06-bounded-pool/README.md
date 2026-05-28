# Step 06 — Bounded pool (동시 실행 한도 · drain)

## 추가된 개념 (step-05 대비)
**여러 작업을 동시에 굴리되, 최대 N개만 동시에 실행하고 나머지는 대기시켜 둔다(PENDING).** 끝나면 다음 PENDING 후보를 자동 승격(drain).

## 왜 필요한가
실제 시스템은 작업이 한 번에 하나만 오지 않습니다. 한꺼번에 10개가 들어와도 GPU/CPU/네트워크는 한정돼 있어 동시 실행 한도가 필요합니다. 그리고 한도가 비면 즉시 다음 작업을 시작해야 합니다(놀리지 않게).

## 핵심 아이디어
- State 가 **여러 작업** 을 보관(Map). status: PENDING/RUNNING/DONE.
- `maxConcurrent` 만큼만 RUNNING 허용.
- ADD_TIMER 또는 TIMER_FINISHED 마다 **drain** 호출 — 빈 슬롯 + PENDING 후보를 짝지어 RUNNING 으로 승격하고 SCHEDULE_TIMER effect 발행.

```ts
function drain(state, issueToken) {
  const free = state.maxConcurrent - count(RUNNING);
  const candidates = pick(PENDING, limit=free);
  // candidates 를 RUNNING 으로 + 각각 SCHEDULE_TIMER effect 발행
}
```

본 레포 `src/scheduler/pool.ts` 의 helper(`availableSlots` · `selectNextCandidates`) 가 같은 일을 한다.

## 실행
```bash
pnpm tsx steps/step-06-bounded-pool/main.ts
```

기대: 4개 타이머 적재, maxConcurrent=2 → 처음 2개만 RUNNING, 2개 PENDING. 500ms 후 결과 도착 → 슬롯이 비자 PENDING 2개가 RUNNING 으로 승격.

## 다음 step
지금은 상태가 메모리에만 있다 — 앱을 끄면 다 사라진다. 그리고 서버 영속화도 없다. **영속화 + 재시작 후 복원** 이 마지막 조각 → **step-07-outbox-reconcile**.
