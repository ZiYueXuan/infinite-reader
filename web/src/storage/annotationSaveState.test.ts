import test from 'node:test'
import assert from 'node:assert/strict'
import { AnnotationSaveStateStore } from './annotationSaveState.ts'

test('older acknowledgements and failures cannot overwrite a newer pending draft', () => {
  const saves = new AnnotationSaveStateStore()
  saves.set('a', 1, 'saving')
  saves.set('a', 2, 'saving')
  saves.set('a', 1, 'saved')
  assert.equal(saves.get('a'), 'saving')
  saves.set('a', 1, 'error')
  assert.equal(saves.get('a'), 'saving')
  saves.set('a', 2, 'error')
  assert.equal(saves.get('a'), 'error')
  saves.set('a', 3, 'saving')
  saves.set('a', 3, 'saved')
  assert.equal(saves.get('a'), 'saved')
})

test('save status is isolated per note and subscribers can unsubscribe', () => {
  const saves = new AnnotationSaveStateStore()
  let notifications = 0
  const unsubscribe = saves.subscribe(() => notifications++)
  saves.set('a', 1, 'saving')
  saves.set('a', 2, 'saving')
  saves.set('b', 3, 'error')
  assert.equal(notifications, 2)
  assert.equal(saves.get('a'), 'saving')
  assert.equal(saves.get('b'), 'error')
  unsubscribe()
  saves.set('a', 2, 'saved')
  assert.equal(notifications, 2)
})
