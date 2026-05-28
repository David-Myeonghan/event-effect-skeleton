import { describe, it, expect } from 'vitest';
import { availableSlots, selectNextCandidates } from '../src/scheduler/pool.js';

describe('bounded pool helpers', () => {
  it('availableSlots = max - (active + opening)', () => {
    expect(availableSlots({ active: new Set(['a']), opening: new Set(['b']) }, 5)).toBe(3);
    expect(availableSlots({ active: new Set(['a', 'b']), opening: new Set() }, 2)).toBe(0);
  });

  it('availableSlots 는 음수가 되지 않는다 (over-subscription 방어)', () => {
    expect(availableSlots({ active: new Set(['a', 'b', 'c']), opening: new Set() }, 1)).toBe(0);
  });

  it('selectNextCandidates 는 순서대로 limit 개의 runnable 만 고른다', () => {
    const jobs = [
      { id: 'a', status: 'RUNNING' },
      { id: 'b', status: 'PENDING' },
      { id: 'c', status: 'PENDING' },
      { id: 'd', status: 'PENDING' },
    ];
    const picked = selectNextCandidates(jobs, (j) => j.status === 'PENDING', 2);
    expect(picked.map((j) => j.id)).toEqual(['b', 'c']);
  });

  it('limit 이 0 이하면 빈 배열', () => {
    expect(selectNextCandidates([{ id: 'a' }], () => true, 0)).toEqual([]);
  });
});
