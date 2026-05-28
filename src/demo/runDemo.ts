// Demo runner — 도메인을 실제로 wire 해서 시나리오를 돌린다.
// `pnpm demo` 로 실행.

import { Runtime } from '../core/runtime.js';
import { HandlerMapInterpreter } from '../effects/interpreter.js';
import { Outbox } from '../effects/outbox.js';
import { FencingTokenIssuer } from '../sync/fencing.js';
import { InMemoryDurableStore } from '../adapters/inMemoryDurableStore.js';
import { FakeWorker } from '../adapters/fakeWorker.js';
import {
  createInitialState,
  createJobQueueReducer,
  type JobEffect,
  type JobEvent,
  type QueueState,
} from './jobQueue.js';
import type { JobSnapshot } from '../ports/durableStore.js';

async function main(): Promise<void> {
  // 1) 어댑터 ─ "현실 세계" 자리.
  const store = new InMemoryDurableStore({ failNextUpserts: 2 }); // outbox backoff 시연
  const worker = new FakeWorker({ delayMs: 30 });

  // 2) Deps + Reducer
  const tokenIssuer = new FencingTokenIssuer();
  const reducer = createJobQueueReducer({ tokenIssuer });

  // 3) Outbox (PERSIST_JOB 전용 영속 sender)
  const outbox = new Outbox<JobSnapshot>(
    {
      send: (snapshot) => store.upsert(snapshot),
    },
    { baseDelayMs: 20, maxDelayMs: 200, maxRetries: 10 },
    (err, payload, attempts) => {
      console.log(`[outbox] retry #${attempts} for job=${payload.id}: ${(err as Error).message}`);
    },
  );

  // 4) Effect Interpreter — kind 별 핸들러 등록.
  const interpreter = new HandlerMapInterpreter<JobEvent, JobEffect>({
    START_WORKER: async (effect, dispatch) => {
      if (effect.kind !== 'START_WORKER') return;
      const outcome = await worker.execute(effect.jobId, effect.token, effect.payload);
      if (outcome.kind === 'success') {
        dispatch({
          kind: 'JOB_RESULT_OK',
          jobId: outcome.jobId,
          token: outcome.token,
          result: outcome.result,
        });
      } else {
        dispatch({
          kind: 'JOB_RESULT_FAIL',
          jobId: outcome.jobId,
          token: outcome.token,
          error: outcome.error,
        });
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
    DELETE_PERSISTED_JOB: (effect) => {
      if (effect.kind !== 'DELETE_PERSISTED_JOB') return;
      void store.delete(effect.jobId);
    },
  });

  // 5) Runtime — 최대 동시 실행 2.
  const runtime = new Runtime<QueueState, JobEvent, JobEffect>(
    createInitialState(2),
    reducer,
    interpreter,
  );

  // 상태 변화 로깅
  runtime.subscribe((state) => {
    const summary = Array.from(state.jobs.values())
      .map((j) => `${j.id}=${j.status}`)
      .join(', ');
    console.log(`[state] ${summary}`);
  });

  // 6) 시나리오
  console.log('--- 시나리오 ① 잡 3개 적재 (슬롯 2개라 하나는 PENDING 으로 대기) ---');
  runtime.dispatch({ kind: 'JOB_ADDED', id: 'a', payload: 'alpha' });
  runtime.dispatch({ kind: 'JOB_ADDED', id: 'b', payload: 'bravo' });
  runtime.dispatch({ kind: 'JOB_ADDED', id: 'c', payload: 'charlie' });

  console.log('--- 시나리오 ② 잡 b 즉시 취소 ---');
  runtime.dispatch({ kind: 'JOB_CANCELLED', id: 'b' });

  console.log('--- 시나리오 ③ 워커 결과 도착(약 30~120ms 소요) ---');
  // worker delay 30ms × 3 + retry 여유 → 500ms 면 충분.
  await new Promise((r) => setTimeout(r, 500));

  console.log('--- 시나리오 ④ 외부 snapshot 흡수 (다른 디바이스에서 추가된 잡 d) ---');
  runtime.dispatch({
    kind: 'SNAPSHOT_RECEIVED',
    rows: [
      { id: 'd', payload: 'delta', status: 'PENDING' },
      // 이미 알고 있는 잡은 ignore — single-writer 보호
      { id: 'a', payload: 'alpha', status: 'PENDING' },
    ],
  });
  await new Promise((r) => setTimeout(r, 200));

  console.log('--- 최종 상태 ---');
  for (const j of runtime.getState().jobs.values()) {
    console.log(`  ${j.id}: ${j.status}${j.result ? ` (result=${j.result})` : ''}`);
  }
  console.log('--- 서버(durable store) 상태 ---');
  for (const s of await store.list()) {
    console.log(`  ${s.id}: ${s.status}${s.result ? ` (result=${s.result})` : ''}`);
  }

  await outbox.flushBeforeExit();
  runtime.dispose();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
