import assert from 'node:assert/strict'
import test from 'node:test'
import { noteConnector, type Point } from './noteConnectorGeometry.ts'

const rect = (x: number, y: number, w: number, h: number): Point[] => [
  { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
]
const rotate = (points: Point[], angle: number) => points.map(({ x, y }) => ({ x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) }))
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

test('left, right, above and below connect at the nearest sheet edges', () => {
  const passage = rect(100, 100, 120, 20)
  for (const [note, startAxis, endAxis, key] of [
    [rect(250, 90, 40, 40), 250, 220, 'x'],
    [rect(10, 90, 40, 40), 50, 100, 'x'],
    [rect(140, 10, 40, 40), 50, 100, 'y'],
    [rect(140, 160, 40, 40), 160, 120, 'y'],
  ] as const) {
    const link = noteConnector(note, [passage])!
    assert.ok(link)
    near(link.start[key], startAxis)
    near(link.end[key], endAxis)
  }
})

test('rotated quads retain boundary contact and the shortest gap', () => {
  for (const angle of [-1.2, -0.3, 0.2, 1.5, Math.PI]) {
    const note = rotate(rect(140, 5, 30, 30), angle)
    const passage = rotate(rect(0, 0, 100, 40), angle)
    const link = noteConnector(note, [passage])!
    assert.ok(link)
    near(Math.hypot(link.end.x - link.start.x, link.end.y - link.start.y), 40)
    const unrotated = rotate([link.start, link.end], -angle)
    near(unrotated[0].x, 140)
    near(unrotated[1].x, 100)
  }
})

test('the nearest visible line wins, regardless of passage ordering', () => {
  const note = rect(230, 110, 50, 50)
  const far = rect(100, 20, 100, 20), nearLine = rect(100, 120, 100, 20)
  for (const passages of [[far, nearLine], [nearLine, far]]) {
    const link = noteConnector(note, passages)!
    assert.ok(link)
    assert.equal(link.end.x, 200)
    assert.ok(link.end.y >= 120 && link.end.y <= 140)
  }
})

test('overlap, containment, crossing edges and touching suppress the entire connector', () => {
  const note = rect(100, 100, 40, 40)
  const away = rect(0, 0, 40, 20)
  for (const passage of [
    rect(120, 120, 40, 20), rect(110, 110, 10, 10), rect(90, 90, 70, 70),
    rect(80, 115, 80, 10), rect(140, 100, 40, 20),
  ]) {
    assert.equal(noteConnector(note, [away, passage]), null)
    assert.equal(noteConnector(note, [passage, away]), null)
  }
})

test('very short connectors and unusable projected geometry are hidden', () => {
  const note = rect(100, 100, 40, 40)
  assert.equal(noteConnector(note, [rect(146, 100, 40, 20)]), null)
  assert.ok(noteConnector(note, [rect(148, 100, 40, 20)]))
  assert.equal(noteConnector(note, []), null)
  assert.equal(noteConnector([], [note]), null)
  for (const invalid of [rect(0, 0, 0, 40), rect(NaN, 0, 40, 40), rect(Infinity, 0, 40, 40), [note[0], note[2], note[1], note[3]]]) {
    assert.equal(noteConnector(invalid, [note]), null)
    assert.equal(noteConnector(note, [invalid]), null)
  }
})
