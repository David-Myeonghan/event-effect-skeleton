# Step 02b — Observer 패턴 (구독 + 통지)

## 이 step 만의 특이점
**Reducer / Event / Runtime 과 *완전히* 분리된** 옵저버 패턴 자체. 우리 라이브러리 코드와 무관한 일반 개념 학습.

옵저버 패턴 = "값이 바뀌었을 때, 미리 등록해 둔 사람들에게 자동으로 알려준다."

## 비유
- **신문 구독**: 신문사에 주소 등록 → 새 신문 나오면 *자동으로* 배달 → 더 안 받고 싶으면 구독 취소.
- **온도 알림**: 온도계에 콜백 등록 → 온도 바뀔 때마다 콜백 호출.

## 핵심 어휘
| 용어 | 역할 |
|---|---|
| **Subject** | 값을 들고 있다가 바뀌면 알리는 쪽 (신문사) |
| **listener / observer** | 알림 받을 함수 (구독자) |
| **subscribe(cb)** | 명단에 콜백 등록. 반환값 = "이 콜백을 명단에서 빼는 함수" |
| **unsubscribe()** | 구독 취소 (위 반환값을 호출) |
| **set(v) / notify** | 값을 바꾸고 모든 listener 를 자동으로 호출하는 동작 |

## 동작 흐름 (한 줄씩)
1. `const sub = subject.subscribe(cb)` — 등록만. **콜백은 아직 호출되지 않음**.
2. 누군가 `subject.set(value)` 를 호출 → Subject 가 listeners 목록의 *모든* 콜백을 호출 → 우리 `cb(value)` 가 *자동으로* 불린다.
3. set 을 여러 번 부르면 cb 도 여러 번 자동 호출.
4. `sub()` (=unsubscribe) → listeners 에서 우리 cb 가 제거. 이후 set 이 와도 우리 cb 는 안 불린다.

> 핵심 오해 해소: subscribe 와 unsubscribe 가 코드 상 가까이 있어도 "바로 끊는 것" 이 아니다. **그 사이의 모든 set 호출 동안** listener 가 작동한다.

## 핵심 코드
```ts
class Subject<T> {
  private value: T;
  private listeners = new Set<(v: T) => void>();

  constructor(initial: T) { this.value = initial; }
  get(): T { return this.value; }

  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);   // ← "자동 통지" 가 일어나는 자리
  }

  subscribe(cb: (v: T) => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };   // ← 반환값 = unsubscribe 함수
  }
}
```

## 실행
```bash
pnpm tsx steps/step-02b-observer-pattern/main.ts
```

## 다음
step-02a 의 Storage 와 이 step 의 Observer 를 **하나로 합치면 우리 Runtime** 이 된다. → **step-02c-subscribe**.
