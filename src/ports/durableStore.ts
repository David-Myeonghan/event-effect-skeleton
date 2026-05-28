// Port — 영속 저장소(원격 서버/DB)의 추상 인터페이스.
// 도메인 코어는 이 Port 에만 의존하고, 실제 구현(서버 SDK·DB 클라이언트 등)은
// adapter 가 제공한다 (Hexagonal).

export interface JobSnapshot {
  readonly id: string;
  readonly payload: string;
  readonly status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  readonly result?: string;
}

export interface DurableStore {
  upsert(snapshot: JobSnapshot): Promise<void>;
  delete(id: string): Promise<void>;
  list(): Promise<JobSnapshot[]>;
}
