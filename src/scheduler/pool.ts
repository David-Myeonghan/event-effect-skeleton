// Bounded worker pool — slot 추적 helper.
//
// 상태(active/opening) 자체는 도메인 state 가 보유하고, 여기는 "얼마나 비었나"
// "다음 후보 누구냐" 같은 결정만 도와주는 순수 함수.
//
// opening 까지 세는 이유: 창을 여는 동안 같은 슬롯에 다른 작업을 또 시작하면
// 동시 실행 한도를 넘어버리기 때문.

export interface SlotState {
  readonly active: ReadonlySet<string>;
  readonly opening: ReadonlySet<string>;
}

export function inUse(slots: SlotState): number {
  return slots.active.size + slots.opening.size;
}

export function availableSlots(slots: SlotState, maxConcurrent: number): number {
  return Math.max(0, maxConcurrent - inUse(slots));
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
