import type { PerspectiveCamera } from 'three'

export const READER_FOV = 24

/** Both the reading desk and product showcase use this front-facing camera orbit. */
export function updateReaderCamera(camera: PerspectiveCamera, x: number, y: number, distance: number, tilt: number) {
  camera.position.set(x, y - distance * Math.sin(tilt), distance * Math.cos(tilt))
  camera.up.set(0, 1, 0)
  camera.lookAt(x, y, 0)
  camera.near = Math.max(1, distance * 0.3)
  camera.far = distance * 4 + 200
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld()
  camera.matrixWorldInverse.copy(camera.matrixWorld).invert()
}
