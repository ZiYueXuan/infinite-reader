import * as THREE from 'three'
import { ellipsizeNoteText, noteFont, NOTE_LINE_HEIGHT, wrapNoteText } from './noteText'
import { ensureNoteFont } from './noteFonts'
import { MARK_COLORS, hash, rng, type Annotation, type MarkColor } from '../book/annotations'

export const NOTE_SIZE = 2.5
export const NOTE_REST_CURL = 0.06
export const NOTE_CURL_HEIGHT = 1.4
/** a closed-book tab is the note squeezed into the flag that sticks out of the fore-edge */
export const TAB_W = 1.5
export const TAB_H = 1.15
const G = 12

let shadowTex: THREE.CanvasTexture | null = null
function getShadowTexture() {
  if (shadowTex) return shadowTex
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')!
  g.filter = 'blur(9px)'
  g.fillStyle = '#000'
  g.fillRect(26, 26, 76, 76)
  shadowTex = new THREE.CanvasTexture(c)
  return shadowTex
}

const INK_COLORS = ['#26335f', '#3a2a55', '#1f4a45', '#5a2a2a']

export const noteInk = (id: string) => INK_COLORS[hash(id) % INK_COLORS.length]

/** A null text draws only the paper, shared with the editable sheet. */
export function drawNoteCanvas(color: MarkColor, text: string | null, id: string, size = 640) {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const base = new THREE.Color(MARK_COLORS[color].note)
  const lighter = base.clone().lerp(new THREE.Color('#ffffff'), 0.28)
  const darker = base.clone().lerp(new THREE.Color('#7a5a20'), 0.14)
  const grad = g.createLinearGradient(0, 0, 0, size)
  grad.addColorStop(0, '#' + lighter.getHexString())
  grad.addColorStop(0.5, '#' + base.getHexString())
  grad.addColorStop(1, '#' + darker.getHexString())
  g.fillStyle = grad
  g.fillRect(0, 0, size, size)
  // paper noise
  const r = rng(hash(id))
  g.globalAlpha = 0.05
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = r() > 0.5 ? '#fff' : '#000'
    g.fillRect(r() * size, r() * size, 2, 2)
  }
  g.globalAlpha = 1
  // adhesive strip
  const strip = g.createLinearGradient(0, 0, 0, size * 0.17)
  strip.addColorStop(0, 'rgba(255,255,255,0.22)')
  strip.addColorStop(0.86, 'rgba(255,255,255,0.08)')
  strip.addColorStop(1, 'rgba(0,0,0,0.07)')
  g.fillStyle = strip
  g.fillRect(0, 0, size, size * 0.17)
  g.fillStyle = 'rgba(0,0,0,0.05)'
  g.fillRect(0, size * 0.17, size, 2)

  const ink = noteInk(id)
  g.fillStyle = ink
  g.textBaseline = 'alphabetic'
  const fs = size * 0.085
  const font = noteFont(text ?? '')
  g.font = `${font.weight} ${fs}px ${font.family}`
  g.fontKerning = 'none'
  const maxW = size * 0.82
  const lines = text === null ? [] : wrapNoteText(text.trim() || '…', maxW, (value) => g.measureText(value).width)
  const lh = fs * NOTE_LINE_HEIGHT
  let y = size * 0.3
  const maxLines = 1 + Math.floor((size * 0.94 - y) / lh)
  lines.slice(0, maxLines).forEach((l, i) => {
    let t = l
    if (i === maxLines - 1 && lines.length > maxLines) t = ellipsizeNoteText(l, maxW, (value) => g.measureText(value).width)
    g.save()
    g.translate(size * 0.09, y)
    g.rotate((r() - 0.5) * 0.012)
    g.fillText(t, 0, 0)
    g.restore()
    y += lh
  })
  // soft vignette, edge darkening
  const edge = g.createRadialGradient(size / 2, size / 2, size * 0.45, size / 2, size / 2, size * 0.78)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(1, 'rgba(60,40,0,0.09)')
  g.fillStyle = edge
  g.fillRect(0, 0, size, size)
  return c
}

export function drawTabCanvas(color: MarkColor, text: string, id: string, w = 600) {
  const h = Math.round((w * TAB_H) / TAB_W)
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const g = c.getContext('2d')!
  const base = new THREE.Color(MARK_COLORS[color].note)
  const lighter = base.clone().lerp(new THREE.Color('#ffffff'), 0.22)
  const deeper = base.clone().lerp(new THREE.Color('#6b4a14'), 0.2)
  const grad = g.createLinearGradient(0, 0, w, 0)
  grad.addColorStop(0, '#' + deeper.getHexString())
  grad.addColorStop(0.14, '#' + base.getHexString())
  grad.addColorStop(0.7, '#' + lighter.getHexString())
  grad.addColorStop(1, '#' + base.getHexString())
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  const r = rng(hash(id))
  g.globalAlpha = 0.06
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() > 0.5 ? '#fff' : '#000'
    g.fillRect(r() * w, r() * h, 2, 2)
  }
  g.globalAlpha = 1
  // a flat sheet sticks out of the pages, so the first stretch is in shadow under the cover
  const sh = g.createLinearGradient(0, 0, w * 0.22, 0)
  sh.addColorStop(0, 'rgba(30,18,0,0.38)')
  sh.addColorStop(1, 'rgba(30,18,0,0)')
  g.fillStyle = sh
  g.fillRect(0, 0, w * 0.22, h)
  // printed lip at the free end + soft paper-edge highlights
  g.fillStyle = 'rgba(255,255,255,0.18)'
  g.fillRect(0, 0, w, 3)
  g.fillStyle = 'rgba(60,40,0,0.14)'
  g.fillRect(0, h - 4, w, 4)
  g.fillStyle = 'rgba(60,40,0,0.12)'
  g.fillRect(w - 5, 0, 5, h)

  const ink = noteInk(id)
  g.fillStyle = ink
  g.textBaseline = 'alphabetic'
  const fs = h * 0.27
  const font = noteFont(text ?? '')
  g.font = `${font.weight} ${fs}px ${font.family}`
  g.fontKerning = 'none'
  const x0 = w * 0.2
  const maxW = w - x0 - w * 0.07
  const all = wrapNoteText(text.trim() || '…', maxW, (value) => g.measureText(value).width)
  const lines = all.slice(0, 3)
  const lh = fs * 1.02
  let y = h * 0.5 - ((lines.length - 1) * lh) / 2 + fs * 0.3
  lines.forEach((l, i) => {
    const more = i === lines.length - 1 && all.length > lines.length
    const t = more ? ellipsizeNoteText(l, maxW, (value) => g.measureText(value).width) : l
    g.save()
    g.translate(x0, y)
    g.rotate((r() - 0.5) * 0.02)
    g.fillText(t, 0, 0)
    g.restore()
    y += lh
  })
  return c
}

export type NoteState = 'free' | 'in' | 'tab' | 'out'

export interface Pose {
  x: number
  y: number
  z: number
  rot: number
  curl: number
  droop: number
  lipY: number
  zTab: number
  /** 0 = full sheet, 1 = squeezed into a fore-edge flag */
  fold?: number
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class NoteObject {
  readonly id: string
  readonly mesh: THREE.Mesh
  readonly shadow: THREE.Mesh
  state: NoteState = 'free'
  pose: Pose
  /** pose where the note is anchored when the book is closed / open */
  freePose: Pose
  tabPose: Pose
  lift = 0
  liftTarget = 0
  held = false
  private from!: Pose
  private to!: Pose
  private tAnim = 0
  private dur = 0.8
  private geo: THREE.PlaneGeometry
  private mat: THREE.MeshStandardMaterial
  private uniforms = {
    uMapB: { value: null as THREE.Texture | null },
    uMix: { value: 0 },
  }
  private texFree: THREE.CanvasTexture
  private texTab: THREE.CanvasTexture
  private color: MarkColor
  private text: string
  private disposed = false
  private fontRequest = 0
  dirty = true
  zOrder = 0

  constructor(a: Annotation) {
    this.id = a.id
    this.color = a.color
    this.text = a.note?.text ?? ''
    this.texFree = new THREE.CanvasTexture(drawNoteCanvas(a.color, this.text, a.id))
    this.texTab = new THREE.CanvasTexture(drawTabCanvas(a.color, this.text, a.id))
    for (const t of [this.texFree, this.texTab]) {
      t.colorSpace = THREE.SRGBColorSpace
      t.anisotropy = 8
    }
    this.geo = new THREE.PlaneGeometry(NOTE_SIZE, NOTE_SIZE, G, G)
    this.mat = new THREE.MeshStandardMaterial({
      map: this.texFree,
      roughness: 0.82,
      side: THREE.DoubleSide,
    })
    this.uniforms.uMapB.value = this.texTab
    this.mat.onBeforeCompile = (shader) => {
      shader.uniforms.uMapB = this.uniforms.uMapB
      shader.uniforms.uMix = this.uniforms.uMix
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D uMapB;\nuniform float uMix;')
        .replace(
          '#include <map_fragment>',
          `vec4 sa = texture2D(map, vMapUv);
vec4 sb = texture2D(uMapB, vMapUv);
diffuseColor *= mix(sa, sb, uMix);`,
        )
    }
    this.mat.customProgramCacheKey = () => 'note-v1'
    this.mesh = new THREE.Mesh(this.geo, this.mat)
    this.mesh.receiveShadow = true
    this.mesh.castShadow = false
    this.mesh.frustumCulled = false
    this.mesh.userData.noteId = a.id
    const sm = new THREE.MeshBasicMaterial({
      map: getShadowTexture(),
      transparent: true,
      depthWrite: false,
      opacity: 0.4,
      color: 0x000000,
    })
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sm)
    this.shadow.position.z = 0.004
    this.shadow.renderOrder = 1
    this.shadow.frustumCulled = false
    const n = a.note
    this.freePose = {
      x: n?.x ?? 0,
      y: n?.y ?? 0,
      z: 0.03,
      rot: 0,
      curl: NOTE_REST_CURL,
      droop: 0,
      lipY: 0,
      zTab: 0,
      fold: 0,
    }
    this.tabPose = { ...this.freePose }
    this.pose = { ...this.freePose }
    this.refreshFont()
  }

  setContent(color: MarkColor, text: string) {
    if (color === this.color && text === this.text) return
    this.color = color
    this.text = text
    this.redrawText()
    this.refreshFont()
  }

  private refreshFont() {
    const request = ++this.fontRequest
    void ensureNoteFont(this.text).then(() => {
      if (!this.disposed && request === this.fontRequest) this.redrawText()
    }).catch(() => { /* Keep readable fallback text if the font is unavailable. */ })
  }

  private redrawText() {
    const { color, text } = this
    this.texFree.image = drawNoteCanvas(color, text, this.id)
    this.texTab.image = drawTabCanvas(color, text, this.id)
    this.texFree.needsUpdate = true
    this.texTab.needsUpdate = true
    this.dirty = true
  }

  /** start flying to a pose */
  flyTo(state: 'in' | 'out', target: Pose, dur = 0.85, delay = 0) {
    this.state = state
    this.from = { ...this.pose }
    this.to = { ...target }
    this.tAnim = -delay
    this.dur = dur
    this.dirty = true
  }

  snapTo(state: 'free' | 'tab', pose: Pose) {
    this.state = state
    this.pose = { ...pose }
    this.uniforms.uMix.value = state === 'tab' ? 1 : 0
    this.dirty = true
  }

  get animating() {
    return this.state === 'in' || this.state === 'out' || this.settlingRotation || Math.abs(this.lift - this.liftTarget) > 0.003 || this.dirty
  }

  private get settlingRotation() {
    return this.state === 'free' && !this.held && Math.abs(this.freePose.rot - this.pose.rot) > 1e-5
  }

  update(dt: number) {
    if (this.state === 'in' || this.state === 'out') {
      this.tAnim += dt
      const t = Math.min(1, Math.max(0, this.tAnim) / this.dur)
      const e = ease(t)
      const a = this.from
      const b = this.to
      // arc over the desk: lift in the middle of the flight
      const arc = Math.sin(Math.PI * Math.min(1, e * 1.0)) * 1.9
      this.pose.x = lerp(a.x, b.x, e)
      this.pose.y = lerp(a.y, b.y, e)
      this.pose.z = lerp(a.z, b.z, e) + arc * (1 - Math.pow(e, 4))
      let dr = b.rot - a.rot
      dr = Math.atan2(Math.sin(dr), Math.cos(dr))
      this.pose.rot = a.rot + dr * e
      this.pose.curl = lerp(a.curl, b.curl, e) + Math.sin(Math.PI * e) * 0.5
      this.pose.droop = lerp(a.droop, b.droop, e)
      this.pose.lipY = b.lipY
      this.pose.zTab = b.zTab
      this.pose.fold = lerp(a.fold ?? 0, b.fold ?? 0, e)
      this.uniforms.uMix.value = this.state === 'in' ? smoothstep(0.55, 0.95, e) : 1 - smoothstep(0.05, 0.45, e)
      if (t >= 1) {
        this.state = this.state === 'in' ? 'tab' : 'free'
        this.pose = { ...b }
        this.uniforms.uMix.value = this.state === 'tab' ? 1 : 0
      }
      this.dirty = true
    }
    if (this.settlingRotation) {
      this.pose.rot += (this.freePose.rot - this.pose.rot) * (1 - Math.exp(-dt * 16))
      if (Math.abs(this.freePose.rot - this.pose.rot) <= 1e-5) this.pose.rot = this.freePose.rot
      this.dirty = true
    }
    this.lift += (this.liftTarget - this.lift) * (1 - Math.exp(-dt * 14))
    if (Math.abs(this.lift - this.liftTarget) < 0.003) this.lift = this.liftTarget
    if (this.dirty || this.lift !== this.liftTarget) this.shape()
    this.dirty = false
  }

  /** CPU shaping of the sheet: peel curl, flight bend and the droop of a tab beyond the cover lip. */
  shape() {
    const p = this.pose
    const pos = this.geo.attributes.position as THREE.BufferAttribute
    const half = NOTE_SIZE / 2
    const c = Math.cos(p.rot)
    const s = Math.sin(p.rot)
    const lift = this.lift
    const fold = p.fold ?? 0
    const sx = lerp(1, TAB_W / NOTE_SIZE, fold)
    const sy = lerp(1, TAB_H / NOTE_SIZE, fold)
    const curlAmt = (p.curl + lift * 0.55) * (1 - fold * 0.8)
    const z0 = p.z + lift * 0.55
    for (let j = 0; j <= G; j++) {
      for (let i = 0; i <= G; i++) {
        const k = j * (G + 1) + i
        const ux = (i / G - 0.5) * NOTE_SIZE
        const uy = (0.5 - j / G) * NOTE_SIZE
        const d = (half - uy) / NOTE_SIZE
        const dd = Math.max(0, d - 0.18) / 0.82
        let z = z0 + curlAmt * dd * dd * NOTE_CURL_HEIGHT
        // side-curl, so a peeled note is not a perfect cylinder
        z += lift * 0.18 * Math.pow(Math.abs(ux / half), 2) * dd
        // the free end of a fore-edge flag sags a little under its own weight
        const tip = Math.max(0, (i / G - 0.35) / 0.65)
        z -= fold * 0.085 * tip * tip
        const lx = ux * sx
        const ly = uy * sy
        const wx = p.x + lx * c - ly * s
        const wy = p.y + lx * s + ly * c
        pos.setXYZ(k, wx, wy, Math.max(0.012, z))
      }
    }
    pos.needsUpdate = true
    this.geo.computeVertexNormals()
    this.geo.computeBoundingSphere()
    // fake soft shadow on the desk
    const h = z0 + lift * 0.4
    const spread = 1.12 + h * 0.14
    this.shadow.scale.setScalar(NOTE_SIZE * 1.9 * spread * lerp(1, 0.6, fold))
    this.shadow.position.set(p.x + 0.16 + h * 0.38, p.y - 0.2 - h * 0.46, 0.006)
    this.shadow.rotation.z = p.rot
    ;(this.shadow.material as THREE.MeshBasicMaterial).opacity = Math.max(0.12, 0.48 / (1 + h * 0.42))
  }

  dispose() {
    this.disposed = true
    this.geo.dispose()
    this.mat.dispose()
    this.texFree.dispose()
    this.texTab.dispose()
    ;(this.shadow.material as THREE.Material).dispose()
    this.shadow.geometry.dispose()
  }
}

function smoothstep(a: number, b: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}
