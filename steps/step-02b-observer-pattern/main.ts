// step-02b-observer-pattern — Reducer/Runtime 과 무관한 옵저버 패턴 단독.
//
// 비유: 온도계 (Subject). 누군가 온도(value) 를 바꾸면, 미리 등록해 둔 모든
// 구독자(listener) 가 자동으로 새 온도를 받아 본다.

class Subject<T> {
  private value: T;
  private readonly listeners = new Set<(v: T) => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  /** 값을 바꾸고 *모든 listener 에게 자동으로* 알린다. */
  set(v: T): void {
    this.value = v;
    for (const l of this.listeners) l(v);
  }

  /** 콜백을 명단에 등록. 반환값을 호출하면 명단에서 빠진다. */
  subscribe(cb: (v: T) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

// ─── 사용 예 ──────────────────────────────────────────────
const temperature = new Subject<number>(20);

console.log('초기 온도 (subscribe 전, get 으로 직접 조회):', temperature.get());
// 출력: 초기 온도 (subscribe 전, get 으로 직접 조회): 20

console.log('--- 구독자 한 명 등록 (아직 콜백은 호출되지 않음) ---');
const unsubscribe = temperature.subscribe((t) => {
  console.log(`[listener] 온도 알림: ${t}°C`);
});
// 출력: --- 구독자 한 명 등록 (아직 콜백은 호출되지 않음) ---
// (이 시점에는 [listener] 줄이 안 찍힌다 — 등록만 된 상태)

console.log('--- set 으로 값 바꾸면 listener 가 자동 호출 ---');
temperature.set(21);
// 출력: --- set 으로 값 바꾸면 listener 가 자동 호출 ---
// 출력: [listener] 온도 알림: 21°C

temperature.set(22);
// 출력: [listener] 온도 알림: 22°C

temperature.set(23);
// 출력: [listener] 온도 알림: 23°C

console.log('--- 구독 취소 ---');
unsubscribe();
// 출력: --- 구독 취소 ---

console.log('--- 취소 후의 set 은 listener 를 호출하지 않는다 ---');
temperature.set(99);
// 출력: --- 취소 후의 set 은 listener 를 호출하지 않는다 ---
// (set 했지만 listener 가 명단에서 빠진 뒤라 [listener] 줄이 안 찍힌다)

console.log('마지막 온도 (get 으로 직접 조회):', temperature.get());
// 출력: 마지막 온도 (get 으로 직접 조회): 99
//   값은 정상으로 99 로 갱신됐다 — get 은 listener 와 무관하게 항상 동작.

// ─── 한 줄 요약 ────────────────────────────────────────
// subscribe = "명단 등록" 만. 호출 자체는 set 이 일어날 때 자동으로.
// unsubscribe = "명단에서 제거". 이후 set 은 우리 콜백을 안 부른다.
// get/set 은 listener 와 무관 — listener 는 set 의 *부가 효과* 일 뿐.
