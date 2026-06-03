// step-01-onoff — Pure Reducer 만 있는 최소 코드.
//
// 핵심: state 는 event 를 받아 새 state 를 돌려주는 "함수의 출력"이다.
// 부수효과·구독·비동기 전부 없음.

type State = {
  on: boolean;
};

type Event =
  | { kind: 'TURN_ON' }
  | { kind: 'TURN_OFF' }
  | { kind: 'TOGGLE' };

function reduce(state: State, event: Event): State {
  switch (event.kind) {
    case 'TURN_ON':
      return { on: true };
    case 'TURN_OFF':
      return { on: false };
    case 'TOGGLE':
      return { on: !state.on };
  }
}

// ─── 사용 예 ──────────────────────────────────────────────
const initial: State = { on: false };

let s = initial;
console.log('initial:', s);
// 출력: initial: { on: false }

s = reduce(s, { kind: 'TURN_ON' });
console.log("after TURN_ON :", s);
// 출력: after TURN_ON : { on: true }

s = reduce(s, { kind: 'TOGGLE' });
console.log("after TOGGLE  :", s);
// 출력: after TOGGLE  : { on: false }   (true → !true → false)

s = reduce(s, { kind: 'TOGGLE' });
console.log("after TOGGLE  :", s);
// 출력: after TOGGLE  : { on: true }    (false → !false → true)

s = reduce(s, { kind: 'TURN_OFF' });
console.log("after TURN_OFF:", s);
// 출력: after TURN_OFF: { on: false }

// 같은 입력이면 같은 출력 — 순수성 확인.
const a = reduce({ on: false }, { kind: 'TOGGLE' });
const b = reduce({ on: false }, { kind: 'TOGGLE' });
console.log('pure (a===b?):', JSON.stringify(a) === JSON.stringify(b));
// 출력: pure (a===b?): true   (같은 입력 → 같은 출력. reducer 가 순수하다는 증거)
