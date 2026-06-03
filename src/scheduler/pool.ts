// Bounded worker pool — slot 계산 helper.
//
// 상태(어떤 job 이 실행 중인지) 자체는 도메인 state 가 보유하고, 여기는
// "얼마나 비었나" "다음 후보 누구냐" 같은 순수 계산만 돕는다.

export function availableSlots(activeCount: number, maxConcurrent: number): number {
  return Math.max(0, maxConcurrent - activeCount);
}

/**
 * `jobs` 를 순서대로 훑어 `isRunnable` 을 만족하는 최대 `limit` 개를 고른다.
 * 정렬은 호출 측이 책임진다 (도메인의 우선순위 규칙).
 */
export function selectNextCandidates<TJob>(
  jobs: readonly TJob[],
  isRunnable: (job: TJob) => boolean,
  limit: number,
): TJob[] {
  if (limit <= 0) return [];
  const out: TJob[] = [];
  for (const job of jobs) {
    if (out.length >= limit) break;
    if (isRunnable(job)) out.push(job);
  }
  return out;
}
