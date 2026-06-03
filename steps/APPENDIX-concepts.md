# 부록 — 보조 개념 (Concepts Appendix)

step 들을 따라가다 보면 "이건 step 의 주제는 아닌데 알아야 넘어가는" 기반 개념들이 나온다.
이 부록은 그것들을 모아 둔 것이다. 각 항목은 어느 step 에서 처음 만나는지 표시했다.

| 개념 | 처음 만나는 곳 | 한 줄 |
|---|---|---|
| [1. 옵저버 패턴 + 구독/해지](#1-옵저버-패턴--구독해지) | step-02b · 02c | 값이 바뀌면 등록된 콜백을 자동 호출 |
| [2. 클로저와 레퍼런스](#2-클로저와-레퍼런스) | step-02b | 구독 해지가 "그 콜백 객체"를 정확히 기억하는 원리 |
| [3. no-op](#3-no-op) | step-05 | 실행은 되지만 상태를 안 바꾸는 동작 |
| [4. 함수 팩토리 / 의존성 주입](#4-함수-팩토리--의존성-주입) | step-05 · 06 · 07 | reducer 순수성을 지키며 token 발급기를 주입 |
| [5. setTimeout = 워커/서버 응답 대역](#5-settimeout--워커서버-응답-대역) | step-04 | 느린 비동기 IO 의 가짜 버전 |

---

## 1. 옵저버 패턴 + 구독/해지

**옵저버 패턴** = "값이 바뀌었을 때, 미리 등록해 둔 사람들에게 자동으로 알려준다." (신문 구독과 같다.)

```ts
class Subject<T> {
  private value: T;
  private listeners = new Set<(v: T) => void>();   // 구독자 명단

  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);           // ← "자동 통지" 가 일어나는 자리
  }

  subscribe(cb: (v: T) => void): () => void {
    this.listeners.add(cb);                          // 등록
    return () => { this.listeners.delete(cb); };     // ← 반환값 = "이 콜백을 빼는 함수"(unsubscribe)
  }
}
```

### 핵심: subscribe 가 "해지 수단"을 함께 발급한다
`subscribe` 는 구독·해지를 **한 메서드에 합친 게 아니다.** 구독하는 순간 **해지 버튼(함수)을 손에 쥐여 줄** 뿐이다.

```ts
const unsubscribe = subject.subscribe(handleChange);  // 등록 + 해지함수 받음
// ... 그 사이의 모든 set() 동안 handleChange 가 자동 호출됨 ...
unsubscribe();                                         // 해지 (명단에서 제거)
```

비유: **놀이공원 입장(subscribe)할 때 퇴장용 손목밴드(unsubscribe)를 같이 채워 준다.** 입장과 퇴장이 한 동작인 게 아니라, 입장하는 순간 퇴장 수단을 받는 것.

> React `useEffect` 가 cleanup 함수를 `return` 하는 패턴이 정확히 이것이다.
> 구독하고 받은 해지 함수를 그대로 `return` 하면, 언마운트 시 React 가 그걸 불러 준다.

---

## 2. 클로저와 레퍼런스

### subscribe 를 여러 번 호출하면 각자 독립된 클로저
`subscribe` 의 **코드(설계도)는 하나**지만, **호출될 때마다 실행 스코프는 새로 찍혀 나온다.**
각 호출의 매개변수 `cb` 는 그 호출 전용이고, 반환된 unsubscribe 함수는 자기를 낳은 스코프의 `cb` 만 붙잡는다.

```ts
const unsubA = subject.subscribe(handlerA);  // 클로저A → handlerA 기억
const unsubB = subject.subscribe(handlerB);  // 클로저B → handlerB 기억 (A 와 격리)

unsubB();  // handlerB 만 명단에서 빠진다. A 는 그대로.
```

함수 매개변수는 `let` 처럼 **호출마다 새로 생기므로**, 100개를 등록하면 격리된 클로저 100개 + unsubscribe 100개가 생기고 각자 자기 것만 정확히 지운다.

### "형태"가 아니라 "레퍼런스"를 기억한다
클로저가 잡는 것도, `Set.delete` 가 비교하는 것도 **함수 객체의 레퍼런스(참조)** 다. `Set` 은 `===`(참조 동일성)으로 멤버를 찾는다.

그래서 **모양이 똑같아도 다른 객체면 못 지운다:**

```ts
subject.subscribe((v) => console.log(v));    // 익명함수 ① @0x1234
subject.unsubscribe((v) => console.log(v));  // 똑같이 생긴 익명함수 ② @0x5678 — 못 지움!
```

①과 ②는 글자 하나 안 틀려도 서로 다른 주소다. 바로 이 함정 때문에 **subscribe 가 unsubscribe 함수를 반환하는 패턴**이 우월하다 — 등록 시점의 *그 정확한 레퍼런스*를 클로저에 가둬 두니까.

> 실무 함정: React 에서 렌더마다 `handleChange` 가 **새 레퍼런스**로 재생성되면, `useEffect` deps 가 매번 "변했다"고 판단해 구독/해지가 무한 반복된다. → `useCallback` 으로 레퍼런스를 고정한다.

---

## 3. no-op

**no-op = "no operation"** = 실행은 되지만 **상태를 하나도 바꾸지 않는** 동작.

step-05 에서 stale 한 `TIMER_FINISHED` 를 dispatch 하면 reducer 가 state 를 그대로 반환한다:

```ts
case 'TIMER_FINISHED': {
  if (state.currentToken !== event.token) {
    return { state, effects: [...] };  // ← state 를 "그대로" 반환 = no-op
  }
  // ...
}
```

이때의 dispatch 가 **no-op dispatch** 다 — 함수는 돌았지만 상태 변화는 0.

### step-05 의 교훈: no-op dispatch 도 listener 를 호출한다
이 학습용 Runtime 의 `dispatch` 는 reduce 결과가 이전 state 와 같든 다르든 **무조건 listener 를 통지**한다(이전 state 와 `Object.is` 비교로 skip 하지 않는다). 그래서 "무시했는데(no-op) 왜 `[state]` 가 또 찍히지?" 가 정상이다.

> 실전 store(Redux/Zustand 등)는 보통 같은 참조면 통지를 건너뛴다. 이 레포는 학습용 단순화를 위해 항상 통지한다.

어원: CPU 명령어 `NOP`(No OPeration, "한 사이클 아무것도 하지 마")에서 온 개발자 은어. 발음 "노옵/놉".

---

## 4. 함수 팩토리 / 의존성 주입

**함수 팩토리 = 함수를 만들어서 돌려주는 함수.** 공장이 제품을 찍어내듯, 함수가 또 다른 함수를 찍어낸다.

```ts
function createReducer(issueToken: () => number) {   // ← 팩토리 (바깥)
  return function reduce(state, event) {              // ← 찍어낸 제품 (안쪽)
    const token = issueToken();                       //   주입받은 issueToken 을 클로저로 사용
    // ...
  };
}

const reduce = createReducer(() => tokenSeq++);  // 팩토리 호출 → reduce 생성
```

### 왜 step-05 에서 이걸 쓰나 — reducer 순수성 때문
reducer 는 순수해야 한다(같은 입력 → 같은 출력). 그런데 fencing token 은 "호출마다 새 번호"가 필요해 모순이다:

```ts
// ❌ reducer 안에서 직접 카운터 증가 → 호출마다 결과가 달라짐 = 순수성 깨짐
let counter = 0;
function reduce(s, e) { const token = ++counter; /* ... */ }
```

팩토리로 **token 발급기를 밖에서 주입**하면, reducer 는 "주입된 `issueToken` 을 부른다"만 하므로 *주입된 의존성에 대해 순수*해진다. token 을 어떻게 증가시키는지(부수효과)는 바깥의 책임으로 밀어낸다. 이것이 **의존성 주입(Dependency Injection)** 이다.

이득:
1. **테스트에서 token 고정 가능** — `createReducer(() => 42)` 로 결정적 테스트.
2. **reducer 는 "어떻게"를 몰라도 된다** — token 을 UUID·서버 발급으로 바꿔도 reducer 코드는 불변.
3. **설정을 기억하는 함수 생성** — 일반형 `makeAdder(10)` → `add10`. (2번 클로저와 같은 원리)

> 실전 `src/demo/jobQueue.ts` 의 `createJobQueueReducer(deps)` 도 동일하게 `tokenIssuer` 를 주입받는다.

---

## 5. setTimeout = 워커/서버 응답 대역

step-04 의 `setTimeout` 은 **"시간이 걸리는 비동기 IO" 의 스탠드인(대역)** 이다. 실제로는 서버 요청/응답·워커 작업·파일 읽기를 대신 표현한 것. 학습용이라 네트워크 없이 `setTimeout` 하나로 "결과가 나중에 도착한다"는 성질만 흉내 낸다.

```ts
// 학습용 (step-04)
setTimeout(() => dispatch({ kind: 'TIMER_FINISHED' }), effect.ms);

// 실제로는
fetch(url).then((res) => dispatch({ kind: 'API_SUCCEEDED', data: res }));
```

가르치려는 건 setTimeout 이 아니라 **비동기 결과가 event 로 돌아오는 통로**다. `[비동기 IO]` 칸에 무엇이 들어가든 구조는 같다:

```
명령 ─event─▶ reducer ─effect─▶ Interpreter ─[비동기 IO]─▶
                                                  └ 끝나면 dispatch(결과 event) ─▶ reducer ↺
```

응답을 받으면 그걸 **다시 event 로 만들어 reducer 를 통과**시켜야 single-writer(단방향)가 유지된다. 그래서 Interpreter 시그니처가 `(effect, dispatch) => void` 로 바뀐 것.

> 완성형 `src/` 에서는 이 `setTimeout` 자리가 **Worker port**(`src/ports/worker.ts`)로 추상화돼 있고, `adapters/fakeWorker.ts` 가 테스트용으로 setTimeout 으로 구현한다.

### 실제 Dentbird Batch 에서는 무엇이 오가나
이 뼈대의 모델이 된 실제 batch 큐(`apps/batch/batch-web/.../ParallelQueueProcessor/`)는 **두 채널**로 요청을 보낸다 — 둘 다 HTTP(localhost:4201) + SSE 다 (Electron 고전 IPC 아님):

| 채널 | 요청 | 응답이 돌아오는 길 |
|---|---|---|
| **연산** (`OPEN_PROCESSOR` effect) | `POST /api/window/create` 로 **별도 BrowserWindow**(design-processor) 를 띄워 디자인 연산 시작 | 그 창이 `POST /api/design-processor/result` → batch-native 가 **SSE `design-processor-result`** 로 fan-out → `dispatch(PROCESSOR_RESULT)` |
| **영속** (`*_DESIGN_CASE_JOB` effect) | `ProjectionOutbox` 경유 `PATCH/POST` 로 서버에 job 상태 저장 | (응답은 UI 를 바꾸지 않는다 — optimistic) |

핵심 차이: **UI 는 서버 응답을 기다려 바뀌는 게 아니다.** dispatch→reduce 가 끝나는 순간 로컬 state 가 즉시 바뀌고 UI 는 그 state 구독에서 갱신된다(optimistic). 서버 PATCH 는 그 뒤 outbox 가 따라갈 뿐. 늦게 온 연산 결과는 `runId`(= fencing token)로 폐기한다(step-05 의 실제 사례, CRWN-3437).

> 단순 경로(잡 1개 추가 → 즉시 실행) 1건이 내는 effect 는 3개다:
> `CREATE_DESIGN_CASE_JOB`(영속) + `WRITE_QUEUE_LOG`(로그) + `OPEN_PROCESSOR`(연산).
> 슬롯이 차 있으면 `OPEN_PROCESSOR` 가 빠져 2개. 갯수는 고정이 아니라 reducer 가 그 상황에서 "할 일"을 0~N개 산출한다.
