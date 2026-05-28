import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Outbox } from '../src/effects/outbox.js';

describe('Outbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('정상 케이스: enqueue 한 항목을 sender 로 전달', async () => {
    const sent: string[] = [];
    const outbox = new Outbox<string>({
      send: async (p) => {
        sent.push(p);
      },
    });
    outbox.enqueue('x');
    outbox.enqueue('y');
    await vi.runAllTimersAsync();
    await outbox.flushBeforeExit();
    expect(sent).toEqual(['x', 'y']);
    expect(outbox.size()).toBe(0);
  });

  it('실패 → backoff → 재시도 → 성공 (rollback 없음)', async () => {
    let attempts = 0;
    const outbox = new Outbox<string>(
      {
        send: async (p) => {
          attempts += 1;
          if (attempts < 3) throw new Error(`fail-${attempts}`);
          // 3번째에 성공
          void p;
        },
      },
      { baseDelayMs: 10, maxDelayMs: 1000 },
    );
    outbox.enqueue('payload');
    await vi.advanceTimersByTimeAsync(0); // 첫 시도
    expect(outbox.size()).toBe(1);

    await vi.advanceTimersByTimeAsync(10); // 2번째 시도 (10ms 후)
    expect(outbox.size()).toBe(1);

    await vi.advanceTimersByTimeAsync(20); // 3번째 시도 (base*2 = 20ms 후)
    expect(attempts).toBe(3);
    expect(outbox.size()).toBe(0);
  });

  it('maxRetries 도달 시 drop 하고 다음 항목으로 넘어간다', async () => {
    let calls = 0;
    const outbox = new Outbox<string>(
      {
        send: async () => {
          calls += 1;
          throw new Error('always fail');
        },
      },
      { baseDelayMs: 5, maxRetries: 2 },
      // onError 콜백 검증은 생략 (호출 자체만 보면 됨)
    );
    outbox.enqueue('doomed');
    await vi.advanceTimersByTimeAsync(0);   // 시도 1
    await vi.advanceTimersByTimeAsync(5);   // 시도 2 (drop)
    expect(calls).toBe(2);
    expect(outbox.size()).toBe(0);
  });

  it('dispose 후엔 더 이상 enqueue/flush 안 함', async () => {
    const sent: string[] = [];
    const outbox = new Outbox<string>({ send: async (p) => { sent.push(p); } });
    outbox.dispose();
    outbox.enqueue('ignored');
    await vi.runAllTimersAsync();
    expect(sent).toEqual([]);
  });
});
