interface PhoneGestureHooks {
  begin(side: 1 | -1, x: number, y: number): boolean
  move(side: 1 | -1, dx: number, y: number): void
  end(velocity: number, cancel: boolean): void
  tap(x: number, y: number): void
  longPress?(x: number, y: number): boolean
  extendSelection?(x: number, y: number): void
  endSelection?(cancel: boolean): void
}

const INTENT_DISTANCE = 12

/** Horizontal intent turns pages; a stationary long press hands selection to the reader. */
export class PhoneGestures {
  private pointers = new Set<number>()
  private longPressTimer: ReturnType<typeof setTimeout> | undefined
  private press: { id: number; x: number; y: number; time: number; lastX: number; lastTime: number; velocity: number; side?: 1 | -1; moved: boolean; selecting?: boolean } | null = null
  private hooks: PhoneGestureHooks
  constructor(hooks: PhoneGestureHooks) { this.hooks = hooks }
  get turning() { return !!this.press?.side }
  get selecting() { return !!this.press?.selecting }

  down(e: PointerEvent) {
    if (e.button !== 0) return
    this.pointers.add(e.pointerId)
    if (this.pointers.size > 1) { this.cancel(); return }
    if (window.getSelection()?.isCollapsed === false) return
    this.press = { id: e.pointerId, x: e.clientX, y: e.clientY, time: e.timeStamp,
      lastX: e.clientX, lastTime: e.timeStamp, velocity: 0, moved: false }
    clearTimeout(this.longPressTimer)
    this.longPressTimer = setTimeout(() => {
      const p = this.press
      if (!p || p.side || p.moved) return
      p.selecting = this.hooks.longPress?.(p.x, p.y) === true
      if (!p.selecting) this.press = null
    }, 450)
  }

  move(e: PointerEvent) {
    const p = this.press
    if (!p || e.pointerId !== p.id) return
    if (p.selecting) {
      if (e.cancelable) e.preventDefault()
      this.hooks.extendSelection?.(e.clientX, e.clientY)
      return
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y
    if (!p.side && Math.hypot(dx, dy) > INTENT_DISTANCE) {
      clearTimeout(this.longPressTimer)
      p.moved = true
      if (Math.abs(dy) > Math.abs(dx) || e.timeStamp - p.time > 450 || window.getSelection()?.isCollapsed === false) {
        this.press = null
        return
      }
      const side = dx < 0 ? 1 : -1
      if (!this.hooks.begin(side, p.x, p.y)) { this.press = null; return }
      p.side = side
    }
    if (!p.side) return
    if (e.cancelable) e.preventDefault()
    p.velocity = (e.clientX - p.lastX) / Math.max(1, e.timeStamp - p.lastTime) * 1000
    p.lastX = e.clientX; p.lastTime = e.timeStamp
    // Consume the intent threshold so crossing it cannot make the paper jump.
    this.hooks.move(p.side, Math.sign(dx) * Math.max(0, Math.abs(dx) - INTENT_DISTANCE), e.clientY)
  }

  up(e: PointerEvent) {
    clearTimeout(this.longPressTimer)
    this.pointers.delete(e.pointerId)
    const p = this.press
    if (!p || p.id !== e.pointerId) return
    this.press = null
    if (p.selecting) {
      this.hooks.endSelection?.(e.type !== 'pointerup')
      return
    }
    if (p.side) this.hooks.end(e.timeStamp - p.lastTime < 100 ? p.velocity : 0, e.type !== 'pointerup')
    else if (!p.moved && e.type === 'pointerup' && e.timeStamp - p.time < 400 && window.getSelection()?.isCollapsed !== false) {
      this.hooks.tap(e.clientX, e.clientY)
    }
  }

  cancel(clearPointers = false) {
    clearTimeout(this.longPressTimer)
    const p = this.press
    this.press = null
    if (p?.side) this.hooks.end(0, true)
    if (p?.selecting) this.hooks.endSelection?.(true)
    if (clearPointers) this.pointers.clear()
  }
}
