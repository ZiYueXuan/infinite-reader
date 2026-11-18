import assert from 'node:assert/strict'
import { readFileSync, statSync } from 'node:fs'
import { test } from 'node:test'
import { fontAssetsFromCss, fontRangeContains } from './fontCatalog.ts'

const root = new URL('../assets/wenkai/', import.meta.url)
const assets = fontAssetsFromCss(readFileSync(new URL('500.css', root), 'utf8'))

test('bundled Wenkai subsets have bounded transfers and disjoint complete Unicode coverage', () => {
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'))
  const covered = new Set<number>()
  assert.equal(assets.length, manifest.subsets)
  for (const asset of assets) {
    assert.equal(asset.family, 'LXGW WenKai')
    assert(statSync(new URL(asset.url, root)).size < 150_000)
    for (const range of asset.range.split(',')) {
      const [first, last = first] = range.slice(2).split('-').map(value => parseInt(value, 16))
      for (let cp = first; cp <= last; cp++) {
        assert(!covered.has(cp), `overlapping code point ${cp}`)
        covered.add(cp)
      }
    }
  }
  assert.equal(covered.size, manifest.codepoints)
  for (const char of '阅读書架笔记Hello, world!') assert(covered.has(char.codePointAt(0)!))
  assert.equal(assets.filter(asset => fontRangeContains(asset.range, 65)).length, 1)
})
