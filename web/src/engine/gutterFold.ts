/** Flexible binding margin of the left paper stack, in its unrotated coordinates.
 * The case rotates around the middle of its thickness; paper at other heights must
 * flex locally to keep its sewn edge on x=0 rather than orbit away from the spine.
 */
export class GutterFold {
  private sin: number
  private cos: number
  private hingeHeight: number

  constructor(theta: number, hingeHeight: number) {
    this.hingeHeight = hingeHeight
    this.sin = theta <= 0 || theta >= Math.PI ? 0 : Math.sin(theta)
    this.cos = Math.cos(theta)
  }

  point(x: number, z: number) {
    const u = Math.min(1, Math.abs(x) / 0.8)
    const weight = 1 - u * u * (3 - 2 * u)
    const dx = (this.hingeHeight - z) * this.sin * weight
    // Inverse-rotate a horizontal correction: the paper's world height is preserved.
    return { x: x + dx * this.cos, z: z + dx * this.sin }
  }
}
