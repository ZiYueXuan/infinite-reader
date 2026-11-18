import { useSyncExternalStore, type CSSProperties } from 'react'

export const MINDMAP_THEMES = [
  { id: 'porcelain', name: '清瓷', description: '冷白画布 · 清透彩枝', canvas: '#f5f7fa', panel: '#ffffff', ink: '#243247', muted: '#5c6979', border: '#dbe2eb', node: '#ffffff', root: '#284b70', rootInk: '#ffffff', branches: ['#4969a6', '#2c7c7a', '#99603d', '#8560a0', '#537b44', '#a4506c'] },
  { id: 'ink', name: '纸墨', description: '温润纸色 · 宋体细线', canvas: '#f5f1e8', panel: '#faf7f0', ink: '#33352f', muted: '#68665c', border: '#d8d2c5', node: '#faf7f0', root: '#343b35', rootInk: '#fffaf0', branches: ['#596b61', '#816247', '#666079', '#7e625d', '#526a78', '#747040'] },
  { id: 'grove', name: '森境', description: '深林底色 · 苔绿与黄铜', canvas: '#172823', panel: '#1d3029', ink: '#edf2e7', muted: '#afc3b5', border: '#3c5548', node: '#243c32', root: '#c5d6ad', rootInk: '#223427', branches: ['#a7c89c', '#d6ba83', '#90c4b3', '#bdb1cd', '#d3a799', '#8bbdd1'] },
  { id: 'midnight', name: '午夜', description: '深蓝夜幕 · 柔光分支', canvas: '#141c2c', panel: '#1b2538', ink: '#edf1fa', muted: '#aab8d1', border: '#394660', node: '#222f46', root: '#b7cafa', rootInk: '#1d2b47', branches: ['#a5bafa', '#7bc8c6', '#c3aaea', '#e2b58a', '#94c6a8', '#e1a9c5'] },
  { id: 'sand', name: '暖砂', description: '奶油暖底 · 陶土与鼠尾草', canvas: '#fbf2eb', panel: '#fff8f2', ink: '#49352f', muted: '#796158', border: '#e7d4c8', node: '#fffaf5', root: '#8e4d3e', rootInk: '#fff8f2', branches: ['#a35745', '#66784c', '#9b6a34', '#8a607d', '#4c7c80', '#876741'] },
] as const
export type MindmapThemeId = typeof MINDMAP_THEMES[number]['id']
export const MINDMAP_THEME_KEY = 'ir:mindmap-theme'
const valid = (value: unknown): MindmapThemeId => MINDMAP_THEMES.some(theme => theme.id === value) ? value as MindmapThemeId : 'porcelain'
function readTheme() {
  try { return valid(localStorage.getItem(MINDMAP_THEME_KEY)) } catch { return 'porcelain' as const }
}
let current = readTheme()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach(fn => fn())
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== MINDMAP_THEME_KEY && event.key !== null) return
  current = event.key === null ? 'porcelain' : valid(event.newValue)
  emit()
})
export function useMindmapTheme() {
  const id = useSyncExternalStore(subscribe, () => current, () => 'porcelain' as const)
  return { theme: MINDMAP_THEMES.find(theme => theme.id === id)!, setTheme: (next: MindmapThemeId) => {
    current = valid(next)
    try { localStorage.setItem(MINDMAP_THEME_KEY, current) } catch { /* Keep the session preference when storage is blocked. */ }
    emit()
  } }
}
export function mindmapThemeStyle(theme: typeof MINDMAP_THEMES[number]): CSSProperties {
  return Object.fromEntries([
    ...(['canvas', 'panel', 'ink', 'muted', 'border', 'node', 'root', 'rootInk'] as const).map(key => [`--map-${key}`, theme[key]]),
    ...theme.branches.map((color, i) => [`--map-branch-${i}`, color]),
  ]) as CSSProperties
}
