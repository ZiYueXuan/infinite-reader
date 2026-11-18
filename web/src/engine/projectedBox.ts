export interface ProjectedMatrix {
  m11: number
  m12: number
  m14: number
  m21: number
  m22: number
  m24: number
  m41: number
  m42: number
  m44: number
}

/**
 * Invert the homography that maps a word box onto the page.
 * Components follow DOMMatrix: translation is m41/m42, and the perspective row is m14/m24/m44.
 * (sx, sy) are pixels in the same space as that matrix.
 */
export function localInProjectedBox(m: ProjectedMatrix, sx: number, sy: number): { x: number; y: number } | null {
  const a11 = m.m11 - sx * m.m14
  const a12 = m.m21 - sx * m.m24
  const a21 = m.m12 - sy * m.m14
  const a22 = m.m22 - sy * m.m24
  const b1 = sx * m.m44 - m.m41
  const b2 = sy * m.m44 - m.m42
  const det = a11 * a22 - a12 * a21
  if (!Number.isFinite(det) || Math.abs(det) < 1e-8) return null
  const x = (b1 * a22 - a12 * b2) / det
  const y = (a11 * b2 - b1 * a21) / det
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}
