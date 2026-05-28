# Step 07 — Outbox + Reconcile (영속 + 복구)

## 추가된 개념 (step-06 대비)
1. **Outbox** — 영속 저장(서버/DB) effect 를 backoff 재시도로 전송. 로컬 상태는 즉시 반영(optimistic), 영속 실패해도 rollback 안 함(eventual).
2. **Reconcile (rehydrate)** — 앱 시작 시 store 에서 list 해서 현재 메모리에 흡수. SNAPSHOT_RECEIVED event 로 들어와 reducer 가 정책에 따라 add / ignore.

## 왜 필요한가
지금까지 만든 모든 상태는 **메모리** 에만 있다. 앱을 끄면 사라지고, 서버에도 안 가 있다. 실제 시스템은:
- "사용자가 잡을 추가했다 → 다른 사람도 봐야 한다" → 영속 필요
- "앱이 죽었다 → 다시 켜면 진행 중이던 잡이 보여야 한다" → 복원 필요
- "여러 디바이스에서 같은 큐를 본다" → 주기 동기화 필요

이 셋을 풀려면 **로컬을 즉시 진실로 쓰면서 동시에 서버에도 결국 도달** 하게 만들어야 한다. 그 사이 네트워크 실패가 있어도 자동 재시도. 이게 **Transactional Outbox** 패턴.

## 핵심
```ts
// Reducer 가 effect 로 영속을 요청한다 — 직접 IO 하지 않음 (순수성 유지)
case 'ADD_TIMER':
  return { state: next, effects: [{ kind: 'PERSIST_TIMER', snapshot }, ...] };

// Outbox 가 enqueue 받아 backoff retry 로 store 에 보낸다
class Outbox { enqueue(s) { ...; flush(); }  flush() { try send; on err setTimeout retry; } }

// 시작 시 store.list() → SNAPSHOT_RECEIVED event 발행 → reducer 가 흡수
function bootstrap() {
  store.list().then(rows => rt.dispatch({ kind: 'SNAPSHOT_RECEIVED', rows }));
}
```

## 실행
```bash
pnpm tsx steps/step-07-outbox-reconcile/main.ts
```

기대 출력 흐름:
1. store 에 미리 잡 'x' 가 있음 (이전 세션 잔재)
2. 부트스트랩 → 'x' 가 메모리에 복원되어 RUNNING 으로 drain
3. 새 잡 'y' 추가 → 영속 시도 → outbox 가 한 번 실패 후 retry 성공
4. 모두 끝나면 store · 메모리 일치

## 더 읽을 거리
이 step 까지 오면 본 레포의 `src/` 완성형 코드(특히 `src/effects/outbox.ts` · `src/sync/reconciler.ts` · `src/demo/jobQueue.ts`)가 같은 패턴을 더 일반화한 형태로 보일 것이다.

여기까지 7단계로 만든 미니 시스템은 실제 Dentbird Batch 큐 와 **본질적으로 같은 뼈대** 다.
