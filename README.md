# event-effect-skeleton

> A generalized architecture skeleton for **asynchronous queues** in TypeScript.
>
> 사용자 명령 + 외부 비동기 결과를 한 Event 스트림으로 받아, 순수 Reducer 가 단독으로 상태를 정하고, Effect Interpreter 가 IO 를 수행하며, **Outbox · Fencing token · Bounded worker pool · Hexagonal** 로 race 와 crash 를 막는 학습용 뼈대.

batch-specific 디테일을 걷어내고 재사용 가능한 골격만 남긴 **스터디 레포**입니다.

---

## 무엇을 푸는가

다음 4박자가 모이면 단순 CRUD 로 안 되고, 이 뼈대가 값을 한다:

1. **비동기 외부 작업**(워커·창·원격)이 돈다
2. 그 와중에 **사용자가 끼어든다**(취소·재정렬·삭제)
3. 결과가 **늦거나 유실/중복**될 수 있다
4. **여러 인스턴스/디바이스**나 **crash 복구**가 필요하다

## 일반화된 뼈대

```
        ┌─────────────── 입력(Inputs) ───────────────┐
        │  사용자 명령(commands)   외부 결과(results)  │
        └───────────────────┬─────────────────────────┘
                            │  전부 Event 하나로 정규화
                            ▼
                 ┌──── Pure Reducer ────┐      ← 단일 상태 결정자
        state ──▶│ (state, event)        │        (single-writer)
                 │   → (state', effects) │
                 └──────────┬────────────┘
                            │ effects = "할 일"을 적은 데이터
                            ▼
                 ┌──── Effect Interpreter (shell) ────┐
                 │   즉시 IO   │   Outbox → durable    │
                 └──────┬──────────────────┬───────────┘
                        ▼                  ▼
                  Workers (N개)        Durable Store
                  (bounded pool)        (서버/DB = 진실)
                        │                  │
              result=Event ◀──── push/poll + reconcile ──┘
              (fencing token으로 stale 결과 폐기)
```

## 8가지 원칙

1. **모든 입력을 하나의 Event 스트림으로** — 사용자 조작도, 외부 작업 결과도 같은 Event 로 들어온다(분기 진입점을 안 만듦).
2. **순수 Reducer 가 유일한 상태 결정자** — `(state, event) → (state', effects)`. IO 없음 → 결정론적 테스트. 동시 변경을 한 줄로 직렬화(single-writer).
3. **부수효과를 "데이터"로 표현** — effect 는 실행이 아니라 *기술*("이걸 해라"). 코어는 effect 만 내고, 실행은 Interpreter 가 한다.
4. **로컬 optimistic + 영속 eventual** — 로컬 상태가 즉시 진실, 영속화(서버)는 Outbox 가 retry 로 따라옴. 영속 실패해도 로컬 rollback 안 함.
5. **Fencing token 으로 stale 폐기** — 작업마다 세대 토큰(runId). 늦게 도착한 옛 작업 결과를 무력화(취소 후 되살아남 방지).
6. **Bounded concurrency + scheduler** — worker N 개 슬롯, "빈 슬롯 있으면 다음 후보 실행(drain)".
7. **Durable=진실, 로컬=mirror, 차이는 reconcile** — push(빠름) + poll(정확) + 시작 시 rehydrate(crash 복구). 세 채널이 한 진실로 수렴.
8. **도메인 엔진은 IO/UI 를 모른다** — 연산 코어는 Port(인터페이스)로만 바깥과 통신 → 여러 환경에서 재사용.

## 코드 구조

```
src/
  core/
    types.ts        — DomainEvent · DomainEffect · Reducer · EffectInterpreter (제네릭)
    reducer.ts      — pureState / withEffect 등 reducer 작성 helper
    runtime.ts      — dispatch → reduce → effects 실행 (single-writer)

  effects/
    interpreter.ts  — effect.kind 별 핸들러 맵 기반 Interpreter
    outbox.ts       — 영속 sender + backoff retry + best-effort flush

  scheduler/
    pool.ts         — availableSlots · selectNextCandidates (slot helper)

  sync/
    fencing.ts      — Generation token issuer + isStale 판정
    reconciler.ts   — apply / add / ignore policy 기반 snapshot 정리

  ports/            — DurableStore · Worker · Clock 추상 (Hexagonal)
  adapters/         — InMemoryDurableStore · FakeWorker · Clocks (구현)

  demo/
    jobQueue.ts     — generic job queue 도메인 (8원칙 전부 만짐)
    runDemo.ts      — 실행 스크립트 (pnpm demo)

tests/              — vitest, 7 spec / 27 tests
```

## 사용법

```bash
pnpm install
pnpm test       # 27 tests · ~300ms
pnpm typecheck  # tsc --noEmit
pnpm demo       # 시나리오 실행
```

### 데모 출력 예시

```
--- 시나리오 ① 잡 3개 적재 (슬롯 2개라 하나는 PENDING 으로 대기) ---
[state] a=PROCESSING
[state] a=PROCESSING, b=PROCESSING
[state] a=PROCESSING, b=PROCESSING, c=PENDING
--- 시나리오 ② 잡 b 즉시 취소 ---
[state] a=PROCESSING, b=CANCELLED, c=PROCESSING   ← c 자동 drain
--- 시나리오 ③ 워커 결과 도착 ---
[outbox] retry #1 for job=a: simulated upsert failure   ← backoff
[outbox] retry #2 for job=a: simulated upsert failure
[state] a=COMPLETED, b=CANCELLED, c=PROCESSING          ← 결과는 즉시 반영 (optimistic)
[state] a=COMPLETED, b=CANCELLED, c=COMPLETED
--- 시나리오 ④ 외부 snapshot 흡수 (다른 디바이스에서 추가된 잡 d) ---
[state] a=COMPLETED, b=CANCELLED, c=COMPLETED, d=PROCESSING
[state] a=COMPLETED, b=CANCELLED, c=COMPLETED, d=COMPLETED
--- 서버(durable store) 상태 ---
  a: COMPLETED · b: CANCELLED · c: COMPLETED · d: COMPLETED   ← 결국 일치
```

## 정식 패턴 키워드 (자체 스터디용)

- **The Elm Architecture (TEA)** / Redux — Model · Update · Msg · Cmd
- **Functional Core, Imperative Shell**
- **Effects as data + Interpreter** 패턴
- **Transactional Outbox** (eventual consistency)
- **Fencing / Generation token** (분산 stale 방어)
- **Hexagonal (Ports & Adapters)**
- **Actor model / Bounded worker pool**
- **CQRS-lite + Reconciliation**

## 코드 ↔ 일반 개념 매핑

| 이 레포 | 일반 개념 |
|---|---|
| `Runtime` | Imperative Shell |
| `Reducer` (`createJobQueueReducer`) | Pure Reducer (Elm `update` / Redux) |
| `DomainEvent` | Message / Command |
| `DomainEffect` | Effect-as-data (Cmd) |
| `HandlerMapInterpreter` | Effect Interpreter |
| `Outbox` | Transactional Outbox |
| `FencingTokenIssuer` / `isStale` | Fencing / Generation token |
| `selectNextCandidates` · `availableSlots` | Bounded worker pool · scheduler |
| `reconcile` | Read-model reconciliation |
| `ports/*` · `adapters/*` | Hexagonal (Ports & Adapters) |

## 학습 동선

### 입문 — `steps/` 부터 한 층씩 (추천)
[`steps/README.md`](steps/README.md) 의 7단계를 1→7 순서로 따라가면 0부터 완성형까지 한 개념씩 추가됩니다. 각 step 은 self-contained `main.ts` 하나 + 짧은 README.

| # | 폴더 | 추가되는 개념 |
|---|---|---|
| 1 | `step-01-onoff` | Pure Reducer |
| 2a | `step-02a-storage` | Storage (state 통 + dispatch) |
| 2b | `step-02b-observer-pattern` | Observer 패턴 단독 (Runtime 과 분리) |
| 2c | `step-02c-subscribe` | Runtime = Storage + Observer 합본 |
| 3 | `step-03-effects` | Effect-as-data + Interpreter |
| 4 | `step-04-async-result` | 비동기 결과를 event 로 (단방향) |
| 5 | `step-05-fencing` | Fencing token (취소 후 늦은 결과 폐기) |
| 6a | `step-06a-multi` | 다중 상태 (타이머 1개 → 여러 개, 한도 없음) |
| 6b | `step-06b-bounded` | 동시 실행 한도 · drain |
| 7a | `step-07a-outbox` | 영속 (Outbox backoff retry, optimistic) |
| 7b | `step-07b-reconcile` | 복구 (시작 시 rehydrate) |

각 step 실행: `pnpm tsx steps/step-XX-.../main.ts`

### 심화 — `src/` 완성형 라이브러리
steps 를 끝낸 뒤엔 `src/` 가 이미 익숙해 보입니다.
1. **이 README 의 8원칙** — 무엇을 푸는 뼈대인지 감 잡기
2. `src/core/types.ts` — 가장 추상적인 골격 타입
3. `src/core/runtime.ts` — `dispatch → reduce → effects` 한 사이클
4. `src/demo/jobQueue.ts` — 일반 패턴을 도메인에 채워 본 예
5. `tests/jobQueueReducer.test.ts` — 각 원칙(특히 ⑤ fencing, ⑥ bounded pool, ⑦ reconcile)의 회귀 가드
6. `tests/demo.integration.test.ts` — 전체 wiring 동작 확인
7. `pnpm demo` — 콘솔에서 시나리오 흐르는 모습 직접 보기

## 적용 vs 비적용

- ✅ 적용 가치: 데스크톱/모바일/웹의 비동기 작업 큐, 빌드 파이프라인, 배포 오케스트레이터, 멀티-디바이스 동기화 SaaS, 분산 워커 시스템
- ❌ 과한 곳: 단순 CRUD, 동기적 폼 처리, 짧은 단발성 요청

## 출처

이 뼈대는 실제 시스템(Dentbird Batch 큐)을 분석해 batch-specific 디테일(IWTK·DesignCaseJob·CRWN-3437 edge case 등)을 걷어내고 남은 **재사용 가능한 골격**입니다. 실 사용 예의 race 시나리오(취소 후 늦은 결과·결과 유실·재시작 잔여 창·cross-device·슬롯 누수)에서 검증된 패턴들의 압축본.
