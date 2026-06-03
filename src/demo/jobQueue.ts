// Demo domain — Generic Job Queue.
//
// 이 파일이 "일반화 뼈대"를 실제로 채워보는 곳이다. 8원칙을 전부 만진다:
//   ① 입력 정규화(사용자 명령 + 워커 결과 모두 Event)
//   ② Pure Reducer (single-writer)
//   ③ Effect-as-data (Reducer 는 effect 객체만 반환)
//   ④ Optimistic + Outbox (PERSIST_JOB effect)
//   ⑤ Fencing token (취소 후 늦은 결과 폐기)
//   ⑥ Bounded pool (slot, drain)
//   ⑦ Reconcile (snapshot 흡수)
//   ⑧ Port-Adapter (worker/store 추상)

import type { DomainEffect, DomainEvent, Reducer } from '../core/types.js';
import { pureState, withEffects } from '../core/reducer.js';
import type { FencingToken } from '../sync/fencing.js';
import { FencingTokenIssuer, isStale } from '../sync/fencing.js';
import { availableSlots, selectNextCandidates } from '../scheduler/pool.js';
import type { JobSnapshot } from '../ports/durableStore.js';
import { reconcile } from '../sync/reconciler.js';
import type { ReconcileDecision } from '../sync/reconciler.js';

// ──────────────────────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────────────────────

export type JobStatus = JobSnapshot['status'];

export interface Job {
  readonly id: string;
  readonly payload: string;
  readonly status: JobStatus;
  /** 현재 활성 run 의 fencing token. PENDING/terminal 이면 null. */
  readonly token: FencingToken | null;
  readonly result?: string;
}

export interface QueueState {
  readonly jobs: ReadonlyMap<string, Job>;
  /** 큐 순서 (도메인 정책). */
  readonly order: readonly string[];
  readonly maxConcurrent: number;
}

export const createInitialState = (maxConcurrent: number): QueueState => ({
  jobs: new Map(),
  order: [],
  maxConcurrent,
});

// ──────────────────────────────────────────────────────────────────────────
// Events (모든 입력 — 사용자 명령 + 워커 결과 + 외부 snapshot)
// ──────────────────────────────────────────────────────────────────────────

export type JobEvent =
  | { kind: 'JOB_ADDED'; id: string; payload: string }
  | { kind: 'JOB_CANCELLED'; id: string }
  | { kind: 'JOB_RESULT_OK'; jobId: string; token: FencingToken; result: string }
  | { kind: 'JOB_RESULT_FAIL'; jobId: string; token: FencingToken; error: string }
  | { kind: 'SNAPSHOT_RECEIVED'; rows: readonly JobSnapshot[] };

// 컴파일 시점 안전성: JobEvent 가 DomainEvent 를 만족하는지 체크.
type _AssertEvent = JobEvent extends DomainEvent ? true : never;
const _eventOk: _AssertEvent = true;
void _eventOk;

// ──────────────────────────────────────────────────────────────────────────
// Effects (할 일을 적은 데이터 — Reducer 는 절대 IO 하지 않는다)
// ──────────────────────────────────────────────────────────────────────────

export type JobEffect =
  | { kind: 'START_WORKER'; jobId: string; token: FencingToken; payload: string }
  | { kind: 'ABORT_WORKER'; jobId: string }
  | { kind: 'PERSIST_JOB'; snapshot: JobSnapshot } // → outbox 경유
  | { kind: 'DELETE_PERSISTED_JOB'; jobId: string }; // → outbox 경유

type _AssertEffect = JobEffect extends DomainEffect ? true : never;
const _effectOk: _AssertEffect = true;
void _effectOk;

// ──────────────────────────────────────────────────────────────────────────
// Reducer 도구 — token issuer 는 외부 주입 (테스트 결정성)
// ──────────────────────────────────────────────────────────────────────────

export interface ReducerDeps {
  readonly tokenIssuer: FencingTokenIssuer;
}

// reducer 내부에서 만드는 잡 → snapshot 헬퍼
const toSnapshot = (job: Job): JobSnapshot => ({
  id: job.id,
  payload: job.payload,
  status: job.status,
  ...(job.result !== undefined ? { result: job.result } : {}),
});

// 슬롯 사용량 — PROCESSING 상태 잡 수.
const countActive = (state: QueueState): number => {
  let n = 0;
  for (const job of state.jobs.values()) {
    if (job.status === 'PROCESSING') n += 1;
  }
  return n;
};

// PENDING 이 후보. 순서는 order 따른다.
const pickRunnable = (state: QueueState, limit: number): Job[] => {
  const orderedJobs: Job[] = [];
  for (const id of state.order) {
    const job = state.jobs.get(id);
    if (job) orderedJobs.push(job);
  }
  return selectNextCandidates(orderedJobs, (j) => j.status === 'PENDING', limit);
};

/**
 * drain — 슬롯 여유만큼 PENDING 을 PROCESSING 으로 승격하고 START_WORKER effect 발행.
 * fencing token 발급은 여기서. (event 처리 결과로 슬롯이 비면 호출)
 */
const drain = (
  state: QueueState,
  deps: ReducerDeps,
): { state: QueueState; effects: JobEffect[] } => {
  const free = availableSlots(countActive(state), state.maxConcurrent);
  if (free <= 0) return { state, effects: [] };

  const candidates = pickRunnable(state, free);
  if (candidates.length === 0) return { state, effects: [] };

  const nextJobs = new Map(state.jobs);
  const effects: JobEffect[] = [];
  for (const job of candidates) {
    const token = deps.tokenIssuer.issue();
    const upgraded: Job = { ...job, status: 'PROCESSING', token };
    nextJobs.set(job.id, upgraded);
    effects.push({ kind: 'START_WORKER', jobId: job.id, token, payload: job.payload });
    effects.push({ kind: 'PERSIST_JOB', snapshot: toSnapshot(upgraded) });
  }
  return { state: { ...state, jobs: nextJobs }, effects };
};

// ──────────────────────────────────────────────────────────────────────────
// Reducer (순수)
// ──────────────────────────────────────────────────────────────────────────

export const createJobQueueReducer =
  (deps: ReducerDeps): Reducer<QueueState, JobEvent, JobEffect> =>
  (state, event) => {
    switch (event.kind) {
      case 'JOB_ADDED': {
        if (state.jobs.has(event.id)) return pureState(state); // 중복 무시
        const job: Job = { id: event.id, payload: event.payload, status: 'PENDING', token: null };
        const nextJobs = new Map(state.jobs);
        nextJobs.set(event.id, job);
        const added: QueueState = {
          ...state,
          jobs: nextJobs,
          order: [...state.order, event.id],
        };
        // 즉시 drain 시도 — 슬롯 여유 있으면 바로 실행
        const drained = drain(added, deps);
        // 영속도 함께 — optimistic: 로컬은 즉시, 서버는 outbox
        return withEffects(drained.state, [
          { kind: 'PERSIST_JOB', snapshot: toSnapshot(job) },
          ...drained.effects,
        ]);
      }

      case 'JOB_CANCELLED': {
        const job = state.jobs.get(event.id);
        if (!job) return pureState(state);
        if (job.status === 'COMPLETED' || job.status === 'CANCELLED' || job.status === 'FAILED') {
          return pureState(state); // 이미 끝남
        }
        const cancelled: Job = { ...job, status: 'CANCELLED', token: null };
        const nextJobs = new Map(state.jobs);
        nextJobs.set(event.id, cancelled);
        const next: QueueState = { ...state, jobs: nextJobs };
        const effects: JobEffect[] = [{ kind: 'PERSIST_JOB', snapshot: toSnapshot(cancelled) }];
        if (job.status === 'PROCESSING') {
          effects.push({ kind: 'ABORT_WORKER', jobId: event.id });
        }
        // 슬롯이 비었으니 drain 재시도
        const drained = drain(next, deps);
        return withEffects(drained.state, [...effects, ...drained.effects]);
      }

      case 'JOB_RESULT_OK': {
        const job = state.jobs.get(event.jobId);
        if (!job) return pureState(state);
        // Fencing — token 다르면 stale 결과. 절대 적용하지 않는다.
        if (isStale(job.token, event.token)) return pureState(state);
        const completed: Job = { ...job, status: 'COMPLETED', token: null, result: event.result };
        const nextJobs = new Map(state.jobs);
        nextJobs.set(event.jobId, completed);
        const next: QueueState = { ...state, jobs: nextJobs };
        const drained = drain(next, deps);
        return withEffects(drained.state, [
          { kind: 'PERSIST_JOB', snapshot: toSnapshot(completed) },
          ...drained.effects,
        ]);
      }

      case 'JOB_RESULT_FAIL': {
        const job = state.jobs.get(event.jobId);
        if (!job) return pureState(state);
        if (isStale(job.token, event.token)) return pureState(state);
        const failed: Job = { ...job, status: 'FAILED', token: null };
        const nextJobs = new Map(state.jobs);
        nextJobs.set(event.jobId, failed);
        const next: QueueState = { ...state, jobs: nextJobs };
        const drained = drain(next, deps);
        return withEffects(drained.state, [
          { kind: 'PERSIST_JOB', snapshot: toSnapshot(failed) },
          ...drained.effects,
        ]);
      }

      case 'SNAPSHOT_RECEIVED': {
        // 폴링/시작 시 원격 snapshot 흡수.
        // policy:
        //   - 로컬에 없는 row 는 add (단 PROCESSING 은 add 안 함 — 다른 소유자의 run)
        //   - 로컬에 terminal/PROCESSING 인 row 는 ignore (single-writer 보호)
        //   - 그 외는 ignore (필요해지면 도메인이 확장)
        const policy = (local: Job | undefined, remote: JobSnapshot): ReconcileDecision => {
          if (!local) {
            if (remote.status === 'PROCESSING') return 'ignore';
            return 'add';
          }
          return 'ignore';
        };
        const { toAdd } = reconcile(
          state.jobs,
          event.rows.map((r) => ({ id: r.id, row: r })),
          policy,
        );
        if (toAdd.length === 0) return pureState(state);
        const nextJobs = new Map(state.jobs);
        const nextOrder = [...state.order];
        for (const { row } of toAdd) {
          nextJobs.set(row.id, {
            id: row.id,
            payload: row.payload,
            status: row.status,
            token: null,
            ...(row.result !== undefined ? { result: row.result } : {}),
          });
          nextOrder.push(row.id);
        }
        const next: QueueState = { ...state, jobs: nextJobs, order: nextOrder };
        const drained = drain(next, deps);
        return withEffects(drained.state, drained.effects);
      }
    }
  };
