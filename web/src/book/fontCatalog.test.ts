import { test } from 'node:test'
import assert from 'node:assert/strict'
import { READER_FONTS, readerFontIdOf, fontAssetsFromCss, fontRangeContains } from './fontCatalog.ts'
test('five stable choices and safe preference migration', () => {
 assert.equal(READER_FONTS.length,5)
 for(const f of READER_FONTS)assert.equal(readerFontIdOf(f.id), f.id)
 assert.equal(readerFontIdOf('unknown'),'wenkai')
})
test('font metadata retains subset, family, weight and first woff2 URL', () => {
 const assets=fontAssetsFromCss(`@font-face {font-family: '中文 Font';font-weight: 200 900; font-style: normal; src:url('/assets/font.woff2') format('woff2'),url(other.woff);unicode-range:U+4E00-9FFF,U+003?;}`)
 assert.deepEqual(assets,[{family:'中文 Font',weight:'200 900',style:'normal',url:'/assets/font.woff2',range:'U+4E00-9FFF,U+003?'}])
 assert.equal(fontRangeContains(assets[0].range,'书'.codePointAt(0)!),true)
 assert.equal(fontRangeContains(assets[0].range,0x35),true)
 assert.equal(fontRangeContains(assets[0].range,0x41),false)
})


test('inlined font URLs retain their MIME separator and base64 payload', () => {
 const assets = fontAssetsFromCss('@font-face {font-family: "Subset";font-weight:500;src:url("data:font/woff2;base64,d09GMg==") format("woff2");unicode-range:U+2026;}')
 assert.equal(assets[0].url, 'data:font/woff2;base64,d09GMg==')
 assert.equal(assets[0].range, 'U+2026')
})
