import test from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { READER_FOV, updateReaderCamera } from '../engine/readerCamera.ts'
import { TILT_MIN, TILT_MAX } from '../settings.ts'
import { STORY_CHAPTERS, chapterStop, storyFrame, bookView, chapterWeight } from './landingStory.ts'

test('every advertised feature has a distinct, reachable stop, including the requested demonstrations', () => {
  assert.ok(STORY_CHAPTERS.length >= 9)
  for (const id of ['perspective', 'markdown', 'atlas']) assert.ok(STORY_CHAPTERS.some(chapter => chapter.id === id))
  STORY_CHAPTERS.forEach((_, i) => {
    assert.equal(storyFrame(chapterStop(i)).index, i)
    assert.equal(chapterWeight(i, storyFrame(chapterStop(i)).time), 1)
  })
  assert.equal(storyFrame(1).index, STORY_CHAPTERS.length - 1)
})

test('reversing or jumping does not leave other chapter overlays visible', () => {
  for (const i of [0, 8, 4, 9, 1, 7, 2, 0]) {
    const time = storyFrame(chapterStop(i)).time
    STORY_CHAPTERS.forEach((_, j) => assert.equal(chapterWeight(j, time), j === i ? 1 : 0))
  }
})

test('view adjustment keeps both sides level and matches the real reader pitch range and readout', () => {
  for (let time = 0; time <= 10; time += .01) {
    const { tilt: pitch, degrees, fraction } = bookView(time)
    assert.ok(pitch >= TILT_MIN && pitch <= TILT_MAX)
    assert.equal(degrees, Math.round(pitch * 180 / Math.PI))
    assert.ok(Math.abs(fraction - (pitch - TILT_MIN) / (TILT_MAX - TILT_MIN)) < 1e-10)
    const camera = new PerspectiveCamera(READER_FOV, 16 / 9)
    updateReaderCamera(camera, 0, 0, 30, pitch)
    assert.equal(camera.position.x, 0)
    for (const y of [-1.7, 1.7]) {
      const left = new Vector3(-2.35, y, .075).project(camera)
      const right = new Vector3(2.35, y, .075).project(camera)
      assert.ok(Math.abs(left.y - right.y) < 1e-10, `edge slopes at ${time}`)
      assert.ok(Math.abs(left.z - right.z) < 1e-10, `sideways perspective at ${time}`)
    }
  }
  assert.equal(bookView(1.18).degrees, 0)
  assert.equal(bookView(1.78).degrees, Math.round(TILT_MAX * 180 / Math.PI))
})
