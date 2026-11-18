import { test } from 'node:test'
import assert from 'node:assert/strict'
import { inferFlatTocLevels } from './tocHierarchy.ts'
import type { TocItem } from './types.ts'

const items = (titles: string[]): TocItem[] => titles.map((title, chapter) => ({ title, chapter, block: chapter + 1, level: 0 }))

test('infers sections only between clearly numbered chapters, preserving source and targets', () => {
  const toc = items(['前言', '这本书尝试回答什么', '第一章 本质', '分词算法', '本章要点 · 第一章', '第二章 价值', 'Token 的价值', '后记', '感谢读者'])
  const original = structuredClone(toc)
  const result = inferFlatTocLevels(toc)
  assert.deepEqual(result.map((item) => item.level), [0, 0, 0, 1, 1, 0, 1, 0, 0])
  assert.deepEqual(toc, original)
  assert.deepEqual(result.map(({ level: _level, ...rest }) => rest), original.map(({ level: _level, ...rest }) => rest))
})

test('keeps source hierarchy and ambiguous flat directories unchanged', () => {
  for (const toc of [
    items(['第一章', '内容', '第三章', '内容']),
    items(['第一章', '内容']),
    items(['一个标题', '另一个标题']),
    [{ ...items(['第一章'])[0], level: 1 }, ...items(['第二章', '内容'])],
  ]) assert.deepEqual(inferFlatTocLevels(toc), toc)
})

test('recognizes Arabic and Chinese chapter numbers beyond ten', () => {
  for (const titles of [['第9章', '内容', '第10章', '内容'], ['第十一章', '内容', '第十二章', '内容'], ['第二十章', '内容', '第二十一章', '内容']]) {
    assert.deepEqual(inferFlatTocLevels(items(titles)).map((item) => item.level), [0, 1, 0, 1])
  }
})

test('recognizes introductory sections before chapters without absorbing a preface', () => {
  const toc = items(['封面', '导言：理解 Token', '导言第一节', '导言第二节', '前言', '前言内容', '第一章', '章节内容', '第二章', '章节内容'])
  assert.deepEqual(inferFlatTocLevels(toc).map((item) => item.level), [0, 0, 1, 1, 0, 0, 0, 1, 0, 1])
  const ambiguous = items(['导言', '一段话', '第一章'])
  assert.deepEqual(inferFlatTocLevels(ambiguous), ambiguous)
})
