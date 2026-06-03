# Steps — 단계별 학습 가이드

이 폴더는 같은 아키텍처 뼈대를 **0부터 한 층씩 쌓아가며** 보여줍니다.

- `src/` = 완성형 라이브러리 (전부 갖춘 형태)
- `steps/` = 학습 경로 (한 개념씩 추가)

각 step 은 **self-contained main.ts 하나**로 실행됩니다. 의존 없음 — 이전 step 코드를 import 하지 않고 그 자리에서 다시 작은 형태로 작성합니다(비교용).

## 순서 (반드시 1 → 7 순서로)

> **핵심(1~4) vs 심화(5~7).** 1~4 는 비동기 UI 어디서나 쓰는 토대다 — 꼭 체화한다.
> 5~7 은 "비동기 + 사용자 끼어듦 + 늦은/유실 결과 + crash 복구" 4박자가 **다 모이는** 시스템에서만
> 필요한 본질적 복잡함이다. 처음엔 "이런 게 있다"만 알고 넘어가도 되고, 실제 그 문제를 만났을 때
> 돌아와 펴 보면 된다. 5~7 이 복잡하게 느껴지는 건 정상 — 코드가 아니라 문제가 복잡한 것이다.

| # | 폴더 | 추가되는 개념 |
|---|---|---|
| **핵심** | | **— 어디서나 재사용** |
| 1 | `step-01-onoff/` | **Pure Reducer** — `(state, event) → new state` |
| 2a | `step-02a-storage/` | **Storage** — state 통 + dispatch 만 (listener 없음) |
| 2b | `step-02b-observer-pattern/` | **Observer 패턴** — Runtime 과 분리한 구독·통지 단독 학습 |
| 2c | `step-02c-subscribe/` | **Runtime** = Storage + Observer 합본 |
| 3 | `step-03-effects/` | **Effect-as-data** — reducer 가 effect 도 반환, Interpreter 가 실행 |
| 4 | `step-04-async-result/` | **비동기 결과를 event 로** — setTimeout 후 새 event dispatch (단방향) |
| **심화** | | **— 4박자 다 모일 때만 (레퍼런스)** |
| 5 | `step-05-fencing/` | **Fencing token** — 취소 후 늦은 결과 폐기 |
| 6a | `step-06a-multi/` | **다중 상태** — 타이머 1개(스칼라) → 여러 개(Map), 한도 없음 |
| 6b | `step-06b-bounded/` | **동시 실행 한도** — maxConcurrent · drain · PENDING 대기 |
| 7a | `step-07a-outbox/` | **영속** — PERSIST effect + Outbox(backoff retry), optimistic |
| 7b | `step-07b-reconcile/` | **복구** — 시작 시 SNAPSHOT_RECEIVED 로 rehydrate |

## 실행

```bash
pnpm tsx steps/step-01-onoff/main.ts
pnpm tsx steps/step-02a-storage/main.ts
pnpm tsx steps/step-02b-observer-pattern/main.ts
pnpm tsx steps/step-02c-subscribe/main.ts
pnpm tsx steps/step-03-effects/main.ts
pnpm tsx steps/step-04-async-result/main.ts
pnpm tsx steps/step-05-fencing/main.ts
pnpm tsx steps/step-06a-multi/main.ts
pnpm tsx steps/step-06b-bounded/main.ts
pnpm tsx steps/step-07a-outbox/main.ts
pnpm tsx steps/step-07b-reconcile/main.ts
```

## 진행 방법

1. 각 step 의 `README.md` 를 먼저 본다 — "무엇이 추가됐고 왜" 가 한 줄로 적혀 있다.
2. `main.ts` 를 읽는다.
3. 실행해서 출력을 본다.
4. **이전 step 과 diff** 떠보기 — `diff steps/step-01*/main.ts steps/step-02*/main.ts` — 정확히 어떤 코드가 늘어났는지 보인다.
5. 다음 step 으로.

7b 까지 끝나면 `src/` 의 완성형 라이브러리가 이미 익숙해 보일 것이다. `src/demo/jobQueue.ts` 는 step-07b 의 약간 더 큰 버전.

## 부록

step 의 주제는 아니지만 따라가려면 알아야 하는 기반 개념 — 옵저버 패턴·클로저/레퍼런스·no-op·함수 팩토리(DI)·`setTimeout` 대역(+실제 Dentbird Batch 매핑) — 은 [`APPENDIX-concepts.md`](APPENDIX-concepts.md) 에 모아 두었다.
