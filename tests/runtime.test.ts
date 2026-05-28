import { describe, it, expect, vi } from 'vitest';
import { Runtime } from '../src/core/runtime.js';
import type { EffectInterpreter, Reducer } from '../src/core/types.js';

// 미니 도메인 — counter
type CounterEvent = { kind: 'INC' } | { kind: 'DEC' } | { kind: 'SET'; value: number };
type CounterEffect = { kind: 'LOG'; message: string };

const reducer: Reducer<{ n: number }, CounterEvent, CounterEffect> = (state, event) => {
  switch (event.kind) {
    case 'INC': return { state: { n: state.n + 1 }, effects: [{ kind: 'LOG', message: `inc → ${state.n + 1}` }] };
    case 'DEC': return { state: { n: state.n - 1 }, effects: [] };
    case 'SET': return { state: { n: event.value }, effects: [] };
  }
};

describe('Runtime', () => {
  it('dispatch → state 갱신 + listener 통지', () => {
    const interp: EffectInterpreter<CounterEvent, CounterEffect> = { run: () => {} };
    const rt = new Runtime({ n: 0 }, reducer, interp);
    const seen: number[] = [];
    rt.subscribe((s) => seen.push(s.n));
    rt.dispatch({ kind: 'INC' });
    rt.dispatch({ kind: 'INC' });
    rt.dispatch({ kind: 'DEC' });
    expect(rt.getState().n).toBe(1);
    expect(seen).toEqual([1, 2, 1]);
  });

  it('reducer 가 산출한 effect 를 interpreter 로 전달', () => {
    const run = vi.fn();
    const interp: EffectInterpreter<CounterEvent, CounterEffect> = { run };
    const rt = new Runtime({ n: 0 }, reducer, interp);
    rt.dispatch({ kind: 'INC' });
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toEqual({ kind: 'LOG', message: 'inc → 1' });
  });

  it('interpreter 가 dispatch 콜백으로 새 event 를 발행 (재진입 가능)', () => {
    const interp: EffectInterpreter<CounterEvent, CounterEffect> = {
      run: (effect, dispatch) => {
        if (effect.kind === 'LOG' && effect.message === 'inc → 1') {
          // 처음 inc 후 한 번 더 inc
          dispatch({ kind: 'INC' });
        }
      },
    };
    const rt = new Runtime({ n: 0 }, reducer, interp);
    rt.dispatch({ kind: 'INC' });
    expect(rt.getState().n).toBe(2);
  });

  it('dispose 후 dispatch 는 무시', () => {
    const interp: EffectInterpreter<CounterEvent, CounterEffect> = { run: () => {} };
    const rt = new Runtime({ n: 0 }, reducer, interp);
    rt.dispose();
    rt.dispatch({ kind: 'INC' });
    expect(rt.getState().n).toBe(0);
  });
});
