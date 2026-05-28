import { describe, it, expect } from 'vitest';
import { reconcile, type ReconcilePolicy } from '../src/sync/reconciler.js';

interface Local { status: string }
interface Remote { status: string }

describe('reconciler', () => {
  const localById = new Map<string, Local>([
    ['a', { status: 'TERMINAL' }],
    ['b', { status: 'PENDING' }],
  ]);

  const remoteSnapshot = [
    { id: 'a', row: { status: 'PENDING' } },  // 로컬은 terminal → ignore
    { id: 'b', row: { status: 'PAUSED' } },   // apply 허용
    { id: 'c', row: { status: 'PENDING' } },  // 로컬에 없음 → add
  ];

  it("policy 'apply'/'add'/'ignore' 가 결과를 분류한다", () => {
    const policy: ReconcilePolicy<Local, Remote> = (local, remote) => {
      if (!local) return 'add';
      if (local.status === 'TERMINAL') return 'ignore';        // single-writer 보호
      if (local.status !== remote.status) return 'apply';
      return 'ignore';
    };

    const { toApply, toAdd } = reconcile(localById, remoteSnapshot, policy);
    expect(toApply.map((r) => r.id)).toEqual(['b']);
    expect(toAdd.map((r) => r.id)).toEqual(['c']);
  });

  it('모두 ignore 면 결과는 빈 배열', () => {
    const { toApply, toAdd } = reconcile(localById, remoteSnapshot, () => 'ignore');
    expect(toApply).toEqual([]);
    expect(toAdd).toEqual([]);
  });
});
