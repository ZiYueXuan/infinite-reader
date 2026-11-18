import type { LayoutConfig } from './layout'

/** The phone reading mode also serves compact iPads; use screen dimensions, not a split-view window. */
export function isPhoneDevice(userAgent: string, touch: boolean, width: number, height: number, maxTouchPoints = 0) {
  // iPadOS can request desktop sites with a Mac UA, even when a trackpad is the primary pointer.
  const ipad = /iPad/i.test(userAgent) || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1)
  if (ipad) return Math.min(width, height) > 0 && Math.min(width, height) <= 800
  if (/Tablet|Android(?!.*Mobile)/i.test(userAgent)) return false
  return /iPhone|iPod|Android.*Mobile/i.test(userAgent) || (touch && Math.min(width, height) <= 600)
}

export function isPhoneBrowser() {
  return typeof window !== 'undefined' && isPhoneDevice(navigator.userAgent,
    matchMedia('(pointer: coarse)').matches, window.screen.width || window.innerWidth,
    window.screen.height || window.innerHeight, navigator.maxTouchPoints)
}

export function phoneLayout(base: LayoutConfig, width: number, height: number, top = 0, bottom = 0, left = 0, right = 0): LayoutConfig {
  return {
    ...base, singlePage: true, pageW: Math.round(width), pageH: Math.round(height),
    marginTop: 52 + top, marginBottom: 44 + bottom,
    marginInner: 24 + Math.max(left, right), marginOuter: 24 + Math.max(left, right),
    fontSize: 20, lineHeight: 1.8,
  }
}
