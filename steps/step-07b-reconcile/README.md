# Step 07b — Reconcile (시작 시 복원 / rehydrate)

## 추가된 개념 (step-07a 대비)
**앱 시작 시 서버 상태를 읽어 메모리를 복원한다.** 서버에서 받은 row 목록을 `SNAPSHOT_RECEIVED` event 로 도메인 입구에 넣고, reducer 가 정책대로 흡수한다.

step-07a 는 "로컬 → 서버" 방향(영속)만 했다. 여기서 "서버 → 로컬" 방향(복원)을 더해 양방향이 닫힌다.

## 왜 필요한가
- "앱이 죽었다 → 다시 켜면 진행 중이던 잡이 보여야 한다" → 복원 필요
- "여러 디바이스에서 같은 큐를 본다" → 시작/주기 동기화 필요

## 핵심 — 정규화 정책이 포인트
```ts
case 'SNAPSHOT_RECEIVED': {
  for (const row of rows) {
    if (timers.has(row.id)) continue;                  // 이미 있으면 건드리지 않음
    // ★ 서버가 RUNNING 으로 줘도 PENDING 으로 낮춰 받는다.
    const status = row.status === 'RUNNING' ? 'PENDING' : row.status;
    timers.set(row.id, { id: row.id, status, token: null });
  }
  return drain(next, issueToken);   // 받은 PENDING 들을 내 token 으로 다시 RUNNING 승격
}
```

**왜 RUNNING → PENDING 으로 낮추나?** 그 RUNNING 은 *다른 인스턴스/이전 세션* 의 run 이다. 이 인스턴스는 그 작업의 token(소유권)을 모른다. 그대로 RUNNING 으로 두면 fencing(step-05)이 성립하지 않는다. 그래서 PENDING 으로 받아 **내 새 token 으로 다시 시작**한다 → fencing 일관성 유지.

## 실행
```bash
pnpm tsx steps/step-07b-reconcile/main.ts
```

기대 출력 (실행으로 검증, store 에 x=RUNNING 잔재 + 첫 upsert 1회 실패):
```
--- 부트스트랩: store.list() → SNAPSHOT_RECEIVED 로 흡수 (x: RUNNING→PENDING 정규화 후 drain) ---
[state] x=RUNNING
--- 새 잡 y, z 추가 ---
[state] x=RUNNING, y=RUNNING
[state] x=RUNNING, y=RUNNING, z=PENDING
[outbox] retry x attempt=1 after 50ms: store upsert failed (left=0)
[state] x=DONE, y=RUNNING, z=RUNNING
[state] x=DONE, y=DONE, z=RUNNING
[state] x=DONE, y=DONE, z=DONE
--- 최종 상태 (메모리 = 서버 로 수렴) ---
memory : x=DONE, y=DONE, z=DONE
store  : x=DONE, y=DONE, z=DONE
```
> `x` 의 `RUNNING→PENDING` 정규화는 **한 번의 reduce 안에서** drain 까지 끝나므로 별도 출력 줄로는 안 보인다(첫 `[state] x=RUNNING` 은 이미 drain 으로 다시 RUNNING 된 결과). 코드 주석의 `SNAPSHOT_RECEIVED` 분기를 같이 보면 흐름이 분명하다.

## 더 읽을 거리
이 step 까지 오면 본 레포의 `src/` 완성형 코드(특히 `src/effects/outbox.ts` · `src/sync/reconciler.ts` · `src/demo/jobQueue.ts`)가 같은 패턴을 더 일반화한 형태로 보일 것이다.

여기까지 만든 미니 시스템은 실제 Dentbird Batch 큐 와 **본질적으로 같은 뼈대** 다.
