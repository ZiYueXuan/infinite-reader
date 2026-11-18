const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

function chapterNumber(title: string): number | null {
  const match = title.trim().match(/^第\s*([0-9零〇一二两三四五六七八九十百千]+)\s*章/)
  if (!match) return null
  const text = match[1]
  if (/^\d+$/.test(text)) return Number(text)
  if (/[0-9]/.test(text)) return null
  if (![...text].some((c) => c in units)) return Number([...text].map((c) => digits[c]).join(''))
  let result = 0
  let digit = 0
  let lastUnit = Infinity
  for (const c of text) {
    if (c in digits) {
      digit = digits[c]
    } else {
      const unit = units[c]
      if (unit >= lastUnit) return null
      result += (digit || 1) * unit
      digit = 0
      lastUnit = unit
    }
  }
  return result + digit
}

// A flat EPUB navigation may omit chapter/section relationships. Infer only a
// display indentation when consecutive numbered chapters provide clear evidence.
export function inferFlatTocLevels<T extends { title: string; level: number }>(toc: readonly T[]): T[] {
  if (toc.some((item) => item.level !== 0)) return [...toc]
  const numbers = toc.map((item) => chapterNumber(item.title)).filter((n): n is number => n !== null)
  if (!numbers.some((n, i) => i > 0 && n === numbers[i - 1] + 1)) return [...toc]

  let inChapter = false
  let seenChapter = false
  return toc.map((item) => {
    if (chapterNumber(item.title) !== null) {
      inChapter = true
      seenChapter = true
      return item
    }
    if (!seenChapter && /^导言(?:\s|[：:·、，,（(]|$)/.test(item.title.trim())) {
      inChapter = true
      return item
    }
    if (/^(?:前言|序言|结语|后记|致谢|附录|参考文献|尾声|跋|关于作者)(?:\s|[：:·、，,（(]|$)/.test(item.title.trim())) {
      inChapter = false
      return item
    }
    return inChapter ? { ...item, level: 1 } : item
  })
}
