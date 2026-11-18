/** Structured content rendered as HTML; model output is never executed as markup. */
export interface ChapterSlide {
  layout: 'overview' | 'points' | 'timeline' | 'comparison';
  title: string;
  takeaway: string;
  items: { heading: string; text: string }[];
}
export interface SlidesResult { title: string; slides: ChapterSlide[]; generatedAt: number; operationId: string }
export interface SlidesState {
  status: 'missing' | 'running' | 'ready' | 'failed' | 'interrupted';
  completed?: number;
  total?: number;
  result?: SlidesResult;
  errorCode?: string;
}
