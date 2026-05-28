import { describe, it, expect } from 'vitest';
import { FencingTokenIssuer, isStale } from '../src/sync/fencing.js';

describe('fencing token', () => {
  it('issues monotonically unique tokens', () => {
    const issuer = new FencingTokenIssuer(() => 1000);
    const a = issuer.issue();
    const b = issuer.issue();
    expect(a).not.toBe(b);
  });

  it('isStale: current 가 없으면 stale', () => {
    expect(isStale(null, 'x')).toBe(true);
    expect(isStale(undefined, 'x')).toBe(true);
  });

  it('isStale: incoming 이 없으면 stale', () => {
    expect(isStale('x', null)).toBe(true);
  });

  it('isStale: 토큰 일치 → 유효', () => {
    expect(isStale('x', 'x')).toBe(false);
  });

  it('isStale: 토큰 불일치(취소 후 늦은 결과) → 폐기', () => {
    expect(isStale('new-token', 'old-token')).toBe(true);
  });
});
