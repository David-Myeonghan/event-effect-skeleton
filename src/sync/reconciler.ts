// Reconciler — 원격(durable) snapshot 과 로컬 mirror 의 차이를 정리.
//
// 원격이 진실, 로컬은 mirror. 단 actor 가 run lifecycle 을 소유한 row 는
// 폴링으로 덮어쓰지 않도록 policy 에서 'ignore' 반환하게 한다.
//
// 결과:
//   - toApply: 로컬에 이미 있고 policy 가 'apply' 라 한 row (덮어쓰기)
//   - toAdd:   로컬에 없고 policy 가 'add' 라 한 row (새로 흡수)
//   - 'ignore' 인 row 는 결과에서 제외 (single-writer 보호 등의 이유)

export type ReconcileDecision = 'apply' | 'ignore' | 'add';

export type ReconcilePolicy<TLocal, TRemote> = (
  local: TLocal | undefined,
  remote: TRemote,
) => ReconcileDecision;

export interface RemoteRow<TId, TRemote> {
  readonly id: TId;
  readonly row: TRemote;
}

export interface ReconcileResult<TId, TRemote> {
  readonly toApply: readonly RemoteRow<TId, TRemote>[];
  readonly toAdd: readonly RemoteRow<TId, TRemote>[];
}

export function reconcile<TLocal, TRemote, TId>(
  localById: ReadonlyMap<TId, TLocal>,
  remoteSnapshot: readonly RemoteRow<TId, TRemote>[],
  policy: ReconcilePolicy<TLocal, TRemote>,
): ReconcileResult<TId, TRemote> {
  const toApply: RemoteRow<TId, TRemote>[] = [];
  const toAdd: RemoteRow<TId, TRemote>[] = [];
  for (const item of remoteSnapshot) {
    const local = localById.get(item.id);
    const decision = policy(local, item.row);
    if (decision === 'apply') toApply.push(item);
    else if (decision === 'add') toAdd.push(item);
    // 'ignore' → skip
  }
  return { toApply, toAdd };
}
