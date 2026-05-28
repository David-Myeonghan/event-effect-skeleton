// Port — 비동기 작업을 수행하는 워커의 추상.
// 실제로는 별도 프로세스/창/스레드/원격 큐 등이 될 수 있다.

export interface WorkerSuccess {
  readonly kind: 'success';
  readonly jobId: string;
  readonly token: string;
  readonly result: string;
}

export interface WorkerFailure {
  readonly kind: 'failure';
  readonly jobId: string;
  readonly token: string;
  readonly error: string;
}

export type WorkerOutcome = WorkerSuccess | WorkerFailure;

export interface Worker {
  /**
   * 작업 실행. token 은 fencing token — 결과 발행 시 그대로 함께 돌려준다.
   * (해 두면 actor 가 stale 여부를 token 일치로 판정.)
   */
  execute(jobId: string, token: string, payload: string): Promise<WorkerOutcome>;
  /** 실행 중인 작업 즉시 취소. */
  abort(jobId: string): Promise<void>;
}
