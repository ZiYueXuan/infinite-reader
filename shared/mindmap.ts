/** Reserved target namespace, distinct from EPUB navigation paths. */
export const annotationMindmapTarget = (id: string) => `annotation:${id}`;
export const isAnnotationMindmap = (target: string) => target.startsWith('annotation:');
export interface MindmapNode { text: string; children: MindmapNode[] }
export interface MindmapResult {
  tree: MindmapNode;
  title: string;
  generatedAt: number;
  model: string;
  operationId: string;
  source?: { annotationId: string; quote: string };
}
export interface MindmapState {
  status: 'missing' | 'running' | 'ready' | 'failed' | 'interrupted';
  result?: MindmapResult;
  cached?: boolean;
  message?: string;
}
export interface MindmapIndex { readyTargets: string[]; pending: boolean }
