// Adapter — 인메모리 DurableStore. 데모/테스트용. 실패 시뮬레이션 옵션 제공.

import type { DurableStore, JobSnapshot } from '../ports/durableStore.js';

export interface InMemoryDurableStoreOptions {
  /** upsert 호출 시 N 번 throw 한 뒤 정상 동작 시작 (outbox backoff 시연용). */
  failNextUpserts?: number;
}

export class InMemoryDurableStore implements DurableStore {
  private readonly map = new Map<string, JobSnapshot>();
  private failuresLeft: number;

  constructor(options: InMemoryDurableStoreOptions = {}) {
    this.failuresLeft = options.failNextUpserts ?? 0;
  }

  async upsert(snapshot: JobSnapshot): Promise<void> {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error(`[InMemoryDurableStore] simulated upsert failure (left=${this.failuresLeft})`);
    }
    this.map.set(snapshot.id, snapshot);
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id);
  }

  async list(): Promise<JobSnapshot[]> {
    return Array.from(this.map.values());
  }

  /** 테스트 검증용 — 도메인이 호출하지 않는다. */
  inspect(): ReadonlyMap<string, JobSnapshot> {
    return new Map(this.map);
  }
}
