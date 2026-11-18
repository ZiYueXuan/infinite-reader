import assert from 'node:assert/strict'
import test from 'node:test'
import { NOTE_FONTS, noteFontIdOf, noteFontFamily } from './noteFontCatalog.ts'
import { annotationSignature, noteLayoutSignature, type Annotation } from './annotations.ts'
import { noteWireAnchor } from './noteTags.ts'

test('legacy and unrecognized font values follow the body; only allowlisted families become CSS', () => {
  for (const value of [undefined, null, '', 'Arial', '__proto__', '";color:red', {}]) {
    assert.equal(noteFontIdOf(value), 'inherit')
    assert.equal(noteFontFamily(value, 'Body Serif'), 'Body Serif')
  }
  for (const { id } of NOTE_FONTS) assert.equal(noteFontIdOf(id), id)
  assert.equal(noteFontFamily('caveat', 'Body Serif'), '"Caveat Variable", "LXGW WenKai", Body Serif')
})

test('font-only changes sync and invalidate pagination; choosing the inherited font is a no-op', () => {
  const a: Annotation = { id:'note', bookId:'book', locator:{chapter:0,start:0,end:3}, quote:'正文',kind:'highlight',color:'pink',createdAt:1,updatedAt:1,note:{text:'想法',x:0,y:0,rot:0} }
  const original = [annotationSignature(a), noteLayoutSignature([a])]
  for (const { id } of NOTE_FONTS) {
    a.note!.font = id
    const anchor = noteWireAnchor(a.note!, a.locator)
    assert.equal(noteFontIdOf(anchor.font), id)
    if (id === 'inherit') {
      assert.ok(!Object.hasOwn(anchor, 'font'))
      assert.deepEqual([annotationSignature(a), noteLayoutSignature([a])], original)
    } else {
      assert.notEqual(annotationSignature(a), original[0])
      assert.notEqual(noteLayoutSignature([a]), original[1])
    }
    assert.equal(a.color,'pink')
  }
})
