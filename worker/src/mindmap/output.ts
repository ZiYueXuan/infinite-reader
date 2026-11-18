import type { MindmapNode, MindmapResult } from '../../../shared/mindmap';
import { HttpError } from '../lib/util';

// Prompt targets remain compact; these are defensive rendering limits, not formatting preferences.
const MAX_NODES = 512, MAX_DEPTH = 12, MAX_CHILDREN = 64, MAX_LABEL = 1000;
export const MAX_MINDMAP_CONTENT = 120_000;
export interface MindmapOutput extends Omit<MindmapResult, 'tree'> { content: string }
const invalid = (code: string, message: string): never => { throw new HttpError(502, code, message); };

export function validateTree(value: unknown): MindmapNode {
  let count = 0;
  const walk = (node: unknown, depth: number): MindmapNode => {
    if (++count > MAX_NODES || depth > MAX_DEPTH) return invalid('mindmap_limits', '导图节点或层级过多，已保留模型结果供检查。');
    if (typeof node === 'string') node = { text: node };
    if (!node || typeof node !== 'object' || Array.isArray(node)) return invalid('mindmap_node', '导图节点格式无法识别，已保留模型结果供检查。');
    const record = node as Record<string, unknown>;
    const text = record.text ?? record.label ?? record.name ?? record.title;
    const children = record.children ?? [];
    if (typeof text !== 'string' || !text.trim()) return invalid('mindmap_label', '导图包含缺少标题的节点，已保留模型结果供检查。');
    if (text.length > MAX_LABEL) return invalid('mindmap_limits', '导图节点文字过长，已保留模型结果供检查。');
    if (!Array.isArray(children)) return invalid('mindmap_children', '导图分支格式无法识别，已保留模型结果供检查。');
    if (children.length > MAX_CHILDREN) return invalid('mindmap_limits', '导图分支过多，已保留模型结果供检查。');
    return { text: text.trim(), children: children.map(child => walk(child, depth + 1)) };
  };
  const tree = walk(value, 0);
  if (!tree.children.length) return invalid('mindmap_empty', '模型只返回了标题，未生成导图分支。');
  return tree;
}

/** Normalize lossless JSON presentation variations, never repair truncated JSON or discard branches. */
export function parseMindmapContent(content: string): MindmapNode {
  if (content.length > MAX_MINDMAP_CONTENT) return invalid('mindmap_limits', '模型返回的导图过大，无法显示。');
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content.trim());
  let value: unknown;
  try { value = JSON.parse(fenced ? fenced[1]! : content); }
  catch { return invalid('mindmap_json', '模型返回的导图 JSON 无法解析，已保留结果供检查。'); }
  // Some JSON-mode responses wrap the root; unwrap only an unambiguous single known wrapper.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (!['text', 'label', 'name', 'title', 'children'].some(key => key in record)) {
      const roots = ['root', 'mindmap', 'tree'].filter(key => key in record);
      if (roots.length === 1) value = record[roots[0]!];
    }
  }
  return validateTree(value);
}
