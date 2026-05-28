# Step 03 — Effects (Effect-as-data)

## 추가된 개념 (step-02 대비)
**Effect-as-data + Interpreter** — reducer 는 새 state 와 함께 "할 일(effect) 객체 리스트"를 돌려주고, **Interpreter** 가 그 effect 를 실제로 실행한다.

## 왜 필요한가
"토글되면 로그를 남기자" 같은 부수효과를 reducer 안에서 `console.log` 로 직접 하면 reducer 가 더 이상 순수하지 않습니다. 그러면:
- 테스트가 어렵다 (실제 IO 발생)
- 재실행 시 부수효과가 다시 일어남

**해결**: reducer 는 "할 일을 적은 데이터"만 돌려주고, 실행은 별도 Interpreter 가 한다. reducer 는 여전히 순수.

```
reducer:    (state, event) → { state, effects }   ← 순수
interpreter: effect → 실제 IO 실행                ← 부수효과 격리
```

## 핵심
```ts
type EffectResult = { state: State; effects: Effect[] };
function reduce(state, event): EffectResult { ... }

class Runtime {
  dispatch(event) {
    const { state, effects } = this.reducer(this.state, event);
    this.state = state;
    // 통지...
    for (const e of effects) this.interpreter(e);  // ← 분리된 실행
  }
}
```

## 실행
```bash
pnpm tsx steps/step-03-effects/main.ts
```

## 다음 step
지금 effect 는 **동기적** 입니다(로그). 만약 "3초 후 자동 OFF" 같이 **비동기 작업** 이라면? Interpreter 가 setTimeout 을 걸고, 결과를 어떻게 도메인에 돌려보낼까? → **step-04-async-result** 에서 interpreter 가 새 event 를 dispatch 하는 패턴(단방향 유지).
