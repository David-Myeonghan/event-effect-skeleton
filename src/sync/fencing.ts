// Fencing / Generation token — 늦게 도착한 stale 응답을 폐기하는 장치.
//
// 비동기 worker 의 결과가 도착할 때, 그 작업의 token 과 현재 추적 중인 token 이
// 다르면(취소 후 새 token 발급됐다거나) 결과를 무력화한다. 분산 시스템의 fencing
// token 과 같은 개념.

export type FencingToken = string;

export class FencingTokenIssuer {
  private seq = 0;

  // 단조 증가 seq 만으로 유일성·신구 판별이 끝난다 (stale 판정은 일치/불일치만 본다).
  issue(): FencingToken {
    this.seq += 1;
    return `t-${this.seq.toString(36)}`;
  }
}

/**
 * 현재 활성 token 과 들어온 token 을 비교해 stale 여부 판정.
 *  - current 가 없으면 활성 작업이 없는 것 → 어떤 결과든 stale.
 *  - current 와 incoming 이 다르면 (예: 취소 후 재시작) → stale.
 */
export function isStale(
  current: FencingToken | null | undefined,
  incoming: FencingToken | null | undefined,
): boolean {
  if (!current || !incoming) return true;
  return current !== incoming;
}
