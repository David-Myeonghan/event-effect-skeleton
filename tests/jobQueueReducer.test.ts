import { describe, it, expect } from 'vitest';
import {
  createInitialState,
  createJobQueueReducer,
  type JobEffect,
  type JobEvent,
  type QueueState,
} from '../src/demo/jobQueue.js';
import { FencingTokenIssuer } from '../src/sync/fencing.js';

function setup(maxConcurrent = 2) {
  const tokenIssuer = new FencingTokenIssuer();
  const reducer = createJobQueueReducer({ tokenIssuer });
  let state: QueueState = createInitialState(maxConcurrent);
  const apply = (event: JobEvent): readonly JobEffect[] => {
    const r = reducer(state, event);
    state = r.state;
    return r.effects;
  };
  return { apply, get state(): QueueState { return state; } };
}

describe('JobQueue reducer (single-writer + bounded pool + fencing + reconcile)', () => {
  it('JOB_ADDED 는 슬롯 여유 시 즉시 PROCESSING 으로 승격 + START_WORKER effect', () => {
    const t = setup(2);
    const eff = t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'p' });
    expect(t.state.jobs.get('a')?.status).toBe('PROCESSING');
    expect(eff.some((e) => e.kind === 'START_WORKER')).toBe(true);
    expect(eff.some((e) => e.kind === 'PERSIST_JOB')).toBe(true);
  });

  it('슬롯 가득 차면 추가 잡은 PENDING 유지', () => {
    const t = setup(1);
    t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'p1' });
    t.apply({ kind: 'JOB_ADDED', id: 'b', payload: 'p2' });
    expect(t.state.jobs.get('a')?.status).toBe('PROCESSING');
    expect(t.state.jobs.get('b')?.status).toBe('PENDING');
  });

  it('JOB_RESULT_OK 정상 토큰 → COMPLETED + 다음 PENDING drain', () => {
    const t = setup(1);
    t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'pa' });
    t.apply({ kind: 'JOB_ADDED', id: 'b', payload: 'pb' });
    const token = t.state.jobs.get('a')?.token;
    expect(token).toBeTruthy();
    t.apply({ kind: 'JOB_RESULT_OK', jobId: 'a', token: token!, result: 'OK' });
    expect(t.state.jobs.get('a')?.status).toBe('COMPLETED');
    expect(t.state.jobs.get('a')?.result).toBe('OK');
    // 슬롯 비었으니 b 가 drain 됨
    expect(t.state.jobs.get('b')?.status).toBe('PROCESSING');
  });

  // 핵심 회귀 가드 — fencing token 으로 stale 결과 폐기.
  // 이 가드가 없으면 "취소된 잡의 늦은 성공 결과가 케이스를 되살린다".
  it('JOB_RESULT_OK 가 stale token 이면 무시(취소 후 늦은 결과)', () => {
    const t = setup(1);
    t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'p' });
    const oldToken = t.state.jobs.get('a')?.token!;
    t.apply({ kind: 'JOB_CANCELLED', id: 'a' });
    // 취소 후 늦게 도착한 결과 — 옛 token
    t.apply({ kind: 'JOB_RESULT_OK', jobId: 'a', token: oldToken, result: 'late OK' });
    expect(t.state.jobs.get('a')?.status).toBe('CANCELLED');
    expect(t.state.jobs.get('a')?.result).toBeUndefined();
  });

  it('JOB_CANCELLED 가 PROCESSING 이면 ABORT_WORKER effect', () => {
    const t = setup(1);
    t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'p' });
    const effects = t.apply({ kind: 'JOB_CANCELLED', id: 'a' });
    expect(effects.some((e) => e.kind === 'ABORT_WORKER')).toBe(true);
    expect(t.state.jobs.get('a')?.status).toBe('CANCELLED');
  });

  it('SNAPSHOT_RECEIVED 가 로컬 모르는 PENDING row 만 add 한다 (single-writer 보호)', () => {
    const t = setup(2);
    t.apply({ kind: 'JOB_ADDED', id: 'a', payload: 'p' });
    const aBefore = t.state.jobs.get('a');
    t.apply({
      kind: 'SNAPSHOT_RECEIVED',
      rows: [
        { id: 'a', payload: 'p', status: 'PENDING' },   // 로컬에 있음 → ignore
        { id: 'remote-x', payload: 'rx', status: 'PENDING' },  // 신규 → add
        { id: 'remote-y', payload: 'ry', status: 'PROCESSING' }, // 다른 소유자 → ignore
      ],
    });
    expect(t.state.jobs.get('a')).toEqual(aBefore);     // 보호됨
    expect(t.state.jobs.get('remote-x')?.status).toBe('PROCESSING'); // drain 으로 승격
    expect(t.state.jobs.has('remote-y')).toBe(false);   // ignore
  });
});
