# Step 02c — Runtime (Storage + Observer 합본)

## 이 step 의 핵심 한 줄
[`step-02a-storage`](../step-02a-storage/) (상태 통) + [`step-02b-observer-pattern`](../step-02b-observer-pattern/) (구독·통지) = **Runtime**.

각각 따로 본 두 개념을 한 클래스로 합친다. 결과:
- state 를 들고 있고 (Storage 부분)
- dispatch 가 일어날 때 listener 들에게 자동으로 알린다 (Observer 부분)

## 두 step 과 어떻게 대응되나
| step-02a Storage | step-02b Subject | step-02c Runtime |
|---|---|---|
| `state` 보관 | `value` 보관 | `state` 보관 |
| `dispatch(event)` → reducer → 새 state | `set(value)` → 직접 값 교체 | `dispatch(event)` → reducer → 새 state + listener 통지 |
| `getState()` | `get()` | `getState()` |
| (없음) | `subscribe(cb)` / `unsubscribe()` | `subscribe(cb)` / `unsubscribe()` |

즉 Runtime 의 `dispatch` 는 **"02a 의 dispatch (state 갱신) + 02b 의 set (listener 통지)" 을 한 줄에 합친 것**.

## 왜 합치는가
- 02a 만 있으면 "상태 바뀐 걸 어떻게 알지?" — 외부가 매번 `getState()` 해야 함.
- 02b 만 있으면 "값을 어떻게 *의미 있게* 바꾸지?" — 그냥 `set(v)` 는 reducer 없이 막 바꿔서 일관성이 없다.
- 둘을 합치면 "**Event 를 dispatch 하면 reducer 가 안전하게 state 를 바꾸고, 동시에 listener 들에게 자동 통지**" 한 줄로 정리.

## 동작 흐름 한 번 더
1. `subscribe(cb)` — listener 등록. **이 시점엔 cb 안 불림** (02b 와 동일).
2. `dispatch(event)` 가 일어날 때마다 Runtime 내부에서:
   - `state = reducer(state, event)` 로 새 state 계산 (02a 부분)
   - 등록된 listener 들 모두 호출 → 우리 cb 가 자동 호출 (02b 부분)
3. `unsubscribe()` 후엔 더 이상 cb 안 불림.
4. `getState()` 는 늘 동기로 현재 state 직접 조회 (listener 무관).

## 실행
```bash
pnpm tsx steps/step-02c-subscribe/main.ts
```

기대 출력 — `dispatch` 4 번 + 마지막 `getState` 1 번 = 5 줄:
```
[state] on=true, toggleCount=0    ← TURN_ON
[state] on=false, toggleCount=1   ← TOGGLE
[state] on=true, toggleCount=2    ← TOGGLE
[state] on=false, toggleCount=2   ← TURN_OFF
final: { on: false, toggleCount: 2 }
```

## 다음 step
지금까지 "상태 변경 + 통지" 까지 왔다. 그런데 "상태가 바뀌면 *외부에 무언가를 더 하고 싶다*" (예: 로그·서버 호출). reducer 안에 `console.log` 를 쓰면 순수성이 깨진다 → **step-03-effects** 에서 effect-as-data 도입.
