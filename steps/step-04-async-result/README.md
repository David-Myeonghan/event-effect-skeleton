# Step 04 — Async result (비동기 결과를 event 로)

## 추가된 개념 (step-03 대비)
**Interpreter 가 비동기 작업을 한 뒤, 그 결과를 새 Event 로 도메인에 돌려준다.**

step-03 의 Interpreter 는 `(effect) => void` 였습니다. 동기 로깅에는 충분했지만 비동기엔 부족합니다. setTimeout 으로 기다린 결과를 어떻게 도메인 state 에 반영할까?

**답**: Interpreter 가 `dispatch` 함수를 받아, 작업이 끝나면 새 Event 를 발행한다.

```
사용자 명령 ─event─▶ reducer ─effect─▶ Interpreter ─비동기 작업─▶
                                                       │
                                                       └ 끝나면 dispatch(새 Event) ─▶ reducer ↺
```

상태 변경은 **항상 reducer 만** 한다는 규칙은 유지됩니다(단방향). Interpreter 는 IO 만 하고, 결과 반영은 reducer 가 결정.

## 왜 단방향인가
"비동기 결과가 도착했다 → state 를 바꾸자" 를 Interpreter 가 직접 하면 reducer 외에 두 번째 state 변경자가 생깁니다. single-writer 가 깨짐 → race · 디버깅 어려움. 그래서 결과도 event 로 정규화해 reducer 를 통과시킨다.

## 핵심
```ts
type Interpreter<Effect, Event> = (
  effect: Effect,
  dispatch: (event: Event) => void
) => void;

// 예:
const interpret: Interpreter<Effect, Event> = (effect, dispatch) => {
  if (effect.kind === 'SCHEDULE_TIMER') {
    setTimeout(() => dispatch({ kind: 'TIMER_FINISHED' }), effect.ms);
  }
};
```

## 실행
```bash
pnpm tsx steps/step-04-async-result/main.ts
```

## ✅ 체크포인트 — 여기까지가 "핵심"
step-01~04 가 비동기 UI 어디서나 재사용하는 토대다: **Pure Reducer + 구독 + Effect-as-data + 비동기 결과를 event 로(단방향).** Redux/useReducer 를 쓰면 매일 만나는 골격이고, 이 네 개만 체화해도 대부분의 비동기 화면을 깔끔하게 다룰 수 있다.

이어지는 **step-05~07 은 "심화"** 다 — "비동기 + 사용자 끼어듦 + 늦은/유실 결과 + crash 복구" 4박자가 다 모이는 시스템(배치 큐·파이프라인 등)에서만 필요하다. 지금 다 외울 필요 없다. 처음엔 "이런 게 있다"만 알고 넘어가도 좋다.

## 다음 step (심화 시작)
타이머가 도는 도중 **취소** 하고 싶다면? 단순히 state 를 inactive 로 바꿔도, 이미 예약된 setTimeout 은 결국 발화하고 `TIMER_FINISHED` event 가 도착해 state 를 또 건드립니다(취소된 케이스가 되살아남) → **step-05-fencing** 에서 fencing token 으로 해결.
