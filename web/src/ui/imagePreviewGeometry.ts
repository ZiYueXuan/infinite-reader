export interface ImageSize { width: number; height: number }
export interface ImageView { zoom: number; rotation: number; x: number; y: number }

export const INITIAL_IMAGE_VIEW: ImageView = { zoom: 1, rotation: 0, x: 0, y: 0 }

export function imageFit(image: ImageSize, viewport: ImageSize, rotation: number) {
  const quarterTurn = Math.abs(rotation % 180) === 90
  const width = quarterTurn ? image.height : image.width
  const height = quarterTurn ? image.width : image.height
  return Math.min(1, viewport.width / Math.max(1, width), viewport.height / Math.max(1, height))
}

export function constrainImage(view: ImageView, image: ImageSize, viewport: ImageSize): ImageView {
  const zoom = Math.max(0.25, Math.min(8, view.zoom))
  const scale = imageFit(image, viewport, view.rotation) * zoom
  const quarterTurn = Math.abs(view.rotation % 180) === 90
  const maxX = Math.max(0, ((quarterTurn ? image.height : image.width) * scale - viewport.width) / 2)
  const maxY = Math.max(0, ((quarterTurn ? image.width : image.height) * scale - viewport.height) / 2)
  return { ...view, zoom, x: maxX ? Math.max(-maxX, Math.min(maxX, view.x)) : 0, y: maxY ? Math.max(-maxY, Math.min(maxY, view.y)) : 0 }
}

/** Keep the point beneath a wheel/pinch gesture fixed while zooming. */
export function zoomImage(view: ImageView, factor: number, pivot: { x: number; y: number }, image: ImageSize, viewport: ImageSize) {
  const zoom = Math.max(0.25, Math.min(8, view.zoom * factor))
  const ratio = zoom / view.zoom
  return constrainImage({ ...view, zoom, x: pivot.x - (pivot.x - view.x) * ratio, y: pivot.y - (pivot.y - view.y) * ratio }, image, viewport)
}
