// Outbox — 영속(서버) 쓰기 effect 를 신뢰성 있게 전송.
//
// 원칙:
//   - actor/reducer 의 로컬 상태가 즉시 진실(optimistic).
//   - 서버 반영은 backoff retry 로 따라옴(eventual).
//   - 실패해도 로컬 rollback 하지 않는다. sync 실패는 별도 신호로 노출.

export interface ProjectionSender<TPayload> {
  send(payload: TPayload): Promise<void>;
}

export interface OutboxOptions {
  /** 첫 재시도 지연(ms). 기본 100. */
  baseDelayMs?: number;
  /** 재시도 지연 상한(ms). 기본 30_000. */
  maxDelayMs?: number;
  /** 최대 재시도 횟수. 기본 Infinity. */
  maxRetries?: number;
}

interface PendingItem<TPayload> {
  payload: TPayload;
  attempts: number;
}

export class Outbox<TPayload> {
  private readonly pending: PendingItem<TPayload>[] = [];
  private flushing = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(
    private readonly sender: ProjectionSender<TPayload>,
    private readonly options: OutboxOptions = {},
    private readonly onError?: (err: unknown, payload: TPayload, attempts: number) => void,
  ) {}

  enqueue(payload: TPayload): void {
    if (this.disposed) return;
    this.pending.push({ payload, attempts: 0 });
    void this.flush();
  }

  size(): number {
    return this.pending.length;
  }

  /**
   * pending 을 가능한 만큼 비운다. 한 항목이 실패하면 backoff 후 재시도 예약하고 리턴.
   * 동시 호출은 첫 호출이 끝날 때까지 idempotent (flushing flag).
   */
  async flush(): Promise<void> {
    if (this.flushing || this.disposed) return;
    this.flushing = true;
    try {
      while (this.pending.length > 0 && !this.disposed) {
        const item = this.pending[0];
        if (!item) break;
        try {
          await this.sender.send(item.payload);
          this.pending.shift();
        } catch (err) {
          item.attempts += 1;
          this.onError?.(err, item.payload, item.attempts);
          const maxRetries = this.options.maxRetries ?? Infinity;
          if (item.attempts >= maxRetries) {
            // 포기 — drop 하고 다음 항목 시도.
            this.pending.shift();
            continue;
          }
          this.scheduleRetry(this.computeDelay(item.attempts));
          return;
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  /** graceful 종료 직전 한 번 더 best-effort 전송. */
  async flushBeforeExit(): Promise<void> {
    this.clearRetry();
    await this.flush();
  }

  dispose(): void {
    this.disposed = true;
    this.clearRetry();
    this.pending.length = 0;
  }

  private computeDelay(attempts: number): number {
    const base = this.options.baseDelayMs ?? 100;
    const max = this.options.maxDelayMs ?? 30_000;
    return Math.min(max, base * Math.pow(2, attempts - 1));
  }

  private scheduleRetry(delay: number): void {
    if (this.retryTimer || this.disposed) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flush();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}
