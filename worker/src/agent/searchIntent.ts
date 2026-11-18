/** Only the current user's direct request can grant web access. Ambiguity stays offline. */
export function requestsWebSearch(question: string): boolean {
  const text = question.normalize('NFKC')
    .replace(/```[\s\S]*?(?:```|$)|`[^`]*(?:`|$)/g, ' ')
    .replace(/^[ \t]*>.*$/gm, ' ')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』|"[^"]*"|'[^'\n]*'/g, ' ')
    .trim()
  // An explicit denial wins, including a denial later in the same message.
  if (/(?:不要|不必|无需|不用|别|禁止|不允许|不需要).{0,20}(?:搜|查|联网|上网|外部|网络)|不(?:联网|上网|搜索)|(?:do\s+not|don't|never|without|no)\b.{0,35}\b(?:search|browse|web|internet|external|online)/i.test(text)) return false
  if (/(?:解释|翻译|分析|举例|假设|如果).{0,16}(?:联网|上网|外部搜索|网络搜索)|(?:联网|外部|网络|网上)搜索.{0,8}(?:是什么|什么意思|如何|怎么)|\b(?:explain|translate|define|what\s+(?:is|does)|if)\b.{0,25}\b(?:web search|search the web|browse)/i.test(text)) return false
  if (/(?:联网|网络|网上|外部)搜索(?:功能|是否|会不会|会|的|有什么|能做|时)|(?:搜索|查找)外部(?:资源|资料)的(?:功能|意思)|\bsearch (?:the )?web\s+(?:means|is|costs|works)\b/i.test(text)) return false
  if (/(?:联网|网络|网上|外部)搜索(?:工具|功能|能力)?\s*(?:吗|么|嘛)[？?]?$/.test(text)) return false
  return text.split(/[\n。！？!?；;，,]/).some(part => {
    const sentence = part.trim()
    return /^(?:(?:请|麻烦|能否|可以|能不能|能|可否|帮我|帮忙|请你|你能|我想|我需要|现在|再|也|并且|并|继续|为我|一下|在|从|去|使用|用|让你)\s*)*(?:(?:联网|上网|上(?:网|网络)上|网上|网络上|互联网上|外网|外部)(?:帮我|帮忙|进行|来|再)?(?:搜(?:索|一下|一搜)?|查(?:找|询|一下|一查)?|找(?:一下|找)?|检索)|(?:搜(?:索|一下|一搜)?|查(?:找|询|一下|一查)?|找(?:一下|找)?|检索)(?:一下|一些|相关的|相关)?(?:外部|网络|网上|互联网|在线|网页)|(?:google|bing|百度)(?:一下|搜索|查找))/i.test(sentence)
      || /^(?:(?:please|can you|could you|would you|will you|i want you to|i need you to|also|now|then)\s+)*(?:(?:search|browse|look up|check|find)\s+(?:on\s+)?(?:the\s+)?(?:web|internet|online|external\s+(?:sources|resources))\b|(?:search|look up|find)\s+.{1,100}\s+(?:on\s+the\s+(?:web|internet)|online)\b|(?:google)\s+\S)/i.test(sentence)
  })
}
