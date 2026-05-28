// Adapter — Fake Worker. setTimeout 으로 지연된 결과를 발행하는 시뮬레이터.
// 실제로는 batch 의 design-processor 창 같은 별도 BrowserWindow 가 이 자리.

import type { Worker, WorkerOutcome } from '../ports/worker.js';

interface Running {
  readonly token: string;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly resolve: (out: WorkerOutcome) => void;
}

export interface FakeWorkerOptions {
  /** 작업 한 건이 걸리는 시간(ms). 기본 10. */
  delayMs?: number;
  /** 처음 N 회는 실패로 반환 (재시도/실패 시연용). */
  failNextN?: number;
  /** payload 를 받아서 결과 문자열을 만든다. 기본은 "processed:{payload}". */
  transform?: (payload: string) => string;
}

export class FakeWorker implements Worker {
  private readonly running = new Map<string, Running>();
  private failuresLeft: number;
  private readonly delayMs: number;
  private readonly transform: (payload: string) => string;

  constructor(options: FakeWorkerOptions = {}) {
    this.failuresLeft = options.failNextN ?? 0;
    this.delayMs = options.delayMs ?? 10;
    this.transform = options.transform ?? ((p) => `processed:${p}`);
  }

  execute(jobId: string, token: string, payload: string): Promise<WorkerOutcome> {
    return new Promise<WorkerOutcome>((resolve) => {
      const timer = setTimeout(() => {
        this.running.delete(jobId);
        if (this.failuresLeft > 0) {
          this.failuresLeft -= 1;
          resolve({ kind: 'failure', jobId, token, error: 'simulated failure' });
          return;
        }
        resolve({ kind: 'success', jobId, token, result: this.transform(payload) });
      }, this.delayMs);
      this.running.set(jobId, { token, timer, resolve });
    });
  }

  async abort(jobId: string): Promise<void> {
    const running = this.running.get(jobId);
    if (!running) return;
    clearTimeout(running.timer);
    this.running.delete(jobId);
    running.resolve({ kind: 'failure', jobId, token: running.token, error: 'aborted' });
  }
}
