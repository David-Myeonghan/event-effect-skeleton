// 통합 — 도메인 + Runtime + Interpreter + Outbox + FakeWorker + InMemoryStore 를
// 실제로 wire 해서 시나리오를 돌린다. 8원칙이 한 데서 동작하는지 확인.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Runtime } from '../src/core/runtime.js';
import { HandlerMapInterpreter } from '../src/effects/interpreter.js';
import { Outbox } from '../src/effects/outbox.js';
import { FencingTokenIssuer } from '../src/sync/fencing.js';
import { InMemoryDurableStore } from '../src/adapters/inMemoryDurableStore.js';
import { FakeWorker } from '../src/adapters/fakeWorker.js';
import {
  createInitialState,
  createJobQueueReducer,
  type JobEffect,
  type JobEvent,
  type QueueState,
} from '../src/demo/jobQueue.js';
import type { JobSnapshot } from '../src/ports/durableStore.js';

describe('end-to-end demo wiring', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('3 잡 적재 → 슬롯 2 라 하나는 PENDING → 완료되면 자동 drain → 모두 COMPLETED', async () => {
    const store = new InMemoryDurableStore();
    const worker = new FakeWorker({ delayMs: 10 });
    const tokenIssuer = new FencingTokenIssuer();
    const reducer = createJobQueueReducer({ tokenIssuer });
    const outbox = new Outbox<JobSnapshot>({ send: (s) => store.upsert(s) });

    const interpreter = new HandlerMapInterpreter<JobEvent, JobEffect>({
      START_WORKER: async (effect, dispatch) => {
        if (effect.kind !== 'START_WORKER') return;
        const outcome = await worker.execute(effect.jobId, effect.token, effect.payload);
        if (outcome.kind === 'success') {
          dispatch({ kind: 'JOB_RESULT_OK', jobId: outcome.jobId, token: outcome.token, result: outcome.result });
        } else {
          dispatch({ kind: 'JOB_RESULT_FAIL', jobId: outcome.jobId, token: outcome.token, error: outcome.error });
        }
      },
      ABORT_WORKER: async (effect) => {
        if (effect.kind !== 'ABORT_WORKER') return;
        await worker.abort(effect.jobId);
      },
      PERSIST_JOB: (effect) => {
        if (effect.kind !== 'PERSIST_JOB') return;
        outbox.enqueue(effect.snapshot);
      },
      DELETE_PERSISTED_JOB: () => {},
    });

    const rt = new Runtime<QueueState, JobEvent, JobEffect>(
      createInitialState(2),
      reducer,
      interpreter,
    );

    rt.dispatch({ kind: 'JOB_ADDED', id: 'a', payload: 'pa' });
    rt.dispatch({ kind: 'JOB_ADDED', id: 'b', payload: 'pb' });
    rt.dispatch({ kind: 'JOB_ADDED', id: 'c', payload: 'pc' });

    expect(rt.getState().jobs.get('a')?.status).toBe('PROCESSING');
    expect(rt.getState().jobs.get('b')?.status).toBe('PROCESSING');
    expect(rt.getState().jobs.get('c')?.status).toBe('PENDING');

    // 워커 결과 도착 (10ms × 여유) + microtask drain
    await vi.advanceTimersByTimeAsync(100);

    const states = ['a', 'b', 'c'].map((id) => rt.getState().jobs.get(id)?.status);
    expect(states).toEqual(['COMPLETED', 'COMPLETED', 'COMPLETED']);

    // 서버에도 영속됨
    const persisted = await store.list();
    const persistedById = new Map(persisted.map((s) => [s.id, s]));
    expect(persistedById.get('a')?.status).toBe('COMPLETED');
    expect(persistedById.get('a')?.result).toBe('processed:pa');
  });

  it('취소 후 늦은 워커 결과가 도착해도 케이스가 되살아나지 않는다 (fencing)', async () => {
    const worker = new FakeWorker({ delayMs: 50 });
    const tokenIssuer = new FencingTokenIssuer();
    const reducer = createJobQueueReducer({ tokenIssuer });
    const outbox = new Outbox<JobSnapshot>({ send: async () => {} });

    const interpreter = new HandlerMapInterpreter<JobEvent, JobEffect>({
      START_WORKER: async (effect, dispatch) => {
        if (effect.kind !== 'START_WORKER') return;
        const outcome = await worker.execute(effect.jobId, effect.token, effect.payload);
        if (outcome.kind === 'success') {
          dispatch({ kind: 'JOB_RESULT_OK', jobId: outcome.jobId, token: outcome.token, result: outcome.result });
        }
      },
      ABORT_WORKER: () => {}, // abort 무시 (의도적: worker 가 그대로 완료해도 fencing 으로 막아야 함)
      PERSIST_JOB: (effect) => {
        if (effect.kind !== 'PERSIST_JOB') return;
        outbox.enqueue(effect.snapshot);
      },
      DELETE_PERSISTED_JOB: () => {},
    });

    const rt = new Runtime<QueueState, JobEvent, JobEffect>(
      createInitialState(1),
      reducer,
      interpreter,
    );

    rt.dispatch({ kind: 'JOB_ADDED', id: 'a', payload: 'pa' });
    await vi.advanceTimersByTimeAsync(10); // 일부 진행
    rt.dispatch({ kind: 'JOB_CANCELLED', id: 'a' });
    expect(rt.getState().jobs.get('a')?.status).toBe('CANCELLED');

    // 워커 결과 도착 — 그러나 token 이 stale 이라 폐기되어야 함
    await vi.advanceTimersByTimeAsync(200);
    expect(rt.getState().jobs.get('a')?.status).toBe('CANCELLED');
    expect(rt.getState().jobs.get('a')?.result).toBeUndefined();
  });
});
