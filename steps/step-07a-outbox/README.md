# Step 07a — Outbox (영속 + backoff 재시도)

## 추가된 개념 (step-06b 대비)
**로컬 상태를 서버(영속 store)에 내보낸다.** 단, 실패해도 로컬을 되돌리지 않고(optimistic) 백그라운드에서 재시도해 결국 도달시킨다(eventual). 이게 **Transactional Outbox** 패턴.

step-06b 까지 만든 모든 상태는 **메모리** 에만 있었다. 앱을 끄면 사라지고 서버에도 없다.

## 왜 이렇게(optimistic + eventual) 하나
- 사용자는 잡을 누르는 즉시 RUNNING 을 봐야 한다 → 로컬 state 를 **먼저** 바꾼다.
- 서버 저장이 네트워크 때문에 잠깐 실패할 수 있다 → 그렇다고 화면을 롤백하면 깜빡임이 끔찍하다.
- 그래서 **로컬=즉시 진실, 영속=따라옴(재시도)** 으로 분리한다.

## 핵심
```ts
// reducer 는 영속을 effect 로 "요청" 만 한다 (직접 IO 안 함 = 순수 유지)
case 'ADD_TIMER':
  return { state: next, effects: [{ kind: 'PERSIST_TIMER', snapshot }, ...drained.effects] };

// Outbox 가 그 요청을 받아 store 로 보내고, 실패하면 backoff 로 재시도
class Outbox {
  enqueue(s) { this.pending.push(...); this.flush(); }
  flush() { try await store.upsert(head); shift(); catch { setTimeout(flush, backoff); } }
}
```

backoff = `min(1000, 50 * 2^(attempts-1))` ms.

## 실행
```bash
pnpm tsx steps/step-07a-outbox/main.ts
```

기대 출력 (실행으로 검증, 첫 upsert 1회 실패 주입):
```
--- 잡 a, b, c 추가 (maxConcurrent=2, 첫 upsert 1회 실패 주입) ---
[state] a=RUNNING
[state] a=RUNNING, b=RUNNING
[state] a=RUNNING, b=RUNNING, c=PENDING
[outbox] retry a attempt=1 after 50ms: store upsert failed (left=0)
[state] a=DONE, b=RUNNING, c=RUNNING
[state] a=DONE, b=DONE, c=RUNNING
[state] a=DONE, b=DONE, c=DONE
--- 최종 상태 (로컬 = 서버 로 수렴) ---
memory : a=DONE, b=DONE, c=DONE
store  : a=DONE, b=DONE, c=DONE
```
영속이 한 번 실패해도 **로컬 state 는 멈추지 않고** 진행하며, 재시도로 서버가 결국 따라온다.

## 다음 step
서버에 저장은 됐는데, **앱을 새로 켜면** 그 내용을 어떻게 메모리로 되살리지? → **step-07b-reconcile** 에서 시작 시 rehydrate.
