// Audit interface source, not user-provided content or protocol identifiers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
const root = path.resolve(import.meta.dirname, '..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, '../shared/messages.json'), 'utf8'))
const files = dir => fs.readdirSync(dir).flatMap(name => {
  const file = path.join(dir, name)
  return fs.statSync(file).isDirectory() ? files(file) : /\.tsx?$/.test(file) && !file.includes('.test.') ? [file] : []
})
const invariant = new Set(['Infinite', 'Infinite Reader', 'INFINITE READER', 'INFINITE ATLAS', 'Esc', 'T', 'MB', 'you@example.com', '000000'])
let translatedCalls = 0, chapterMessages = 0
const problems = []
for (const file of files(path.join(root, 'src')).filter(file => !file.includes('/i18n/'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const report = (node, text) => problems.push(`${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.pos).line + 1}: ${text}`)
  const walk = node => {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      translatedCalls++
      if (!Object.hasOwn(catalog, node.arguments[0].text)) report(node, 'missing catalog key ' + node.arguments[0].text)
    }
    // Chapter copy is passed to t(chapter.label/title/text), so literal-call checks
    // alone cannot catch a missing catalog entry in this data-driven UI.
    if (path.relative(root, file) === 'src/ui/landingStory.ts' && ts.isPropertyAssignment(node) &&
      ['label', 'title', 'text'].includes(node.name.getText(source)) && ts.isStringLiteral(node.initializer)) {
      chapterMessages++
      if (!Object.hasOwn(catalog, node.initializer.text)) report(node, 'missing chapter catalog key ' + node.initializer.text)
    }
    let text
    if (ts.isJsxText(node)) text = node.text.trim()
    if (ts.isJsxAttribute(node) && ['title', 'aria-label', 'placeholder', 'alt', 'label'].includes(node.name.text) && node.initializer && ts.isStringLiteral(node.initializer)) text = node.initializer.text
    if (text && /[\p{L}]/u.test(text) && !invariant.has(text)) report(node, 'untranslated interface literal ' + text)
    ts.forEachChild(node, walk)
  }
  walk(source)
}
assert.deepEqual(problems, [])
console.log(`PASS ${translatedCalls} translated calls and ${chapterMessages} chapter messages; no uncatalogued keys or untranslated UI literals (excluding brands, units and keyboard names).`)
