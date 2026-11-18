export interface ReferencedBook {
  title: string;
  author: string | null;
  quote: string;
}
export interface BookListResult {
  /** Candidates omitted because their structure or source evidence could not be verified. */
  excludedCandidates?: number;
  books: ReferencedBook[];
  generatedAt: number;
  operationId: string;
}
export interface BookListState {
  status: 'missing' | 'running' | 'ready' | 'failed' | 'interrupted';
  completed?: number;
  total?: number;
  errorCode?: string;
  result?: BookListResult;
}
