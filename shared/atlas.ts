export interface AtlasPlace {
  id: string
  name: string
  modernName: string
  coordinates: [number, number]
  /** Location in the original, unrotated image. AI anchors are approximate. */
  imagePoint: [number, number] | null
}

export interface BookMap {
  id: string
  title: string
  period: string
  number: string
  bounds: [[number, number], [number, number]]
  center: [number, number]
  image: { sha256: string; bytes: number }
  places: AtlasPlace[]
  recognition?: { model: string; unresolved: string[] }
}

export interface AtlasRecognition {
  status: 'recognized' | 'not_map' | 'uncertain'
  map: BookMap | null
  message: string
  model: string
  recognizedAt: number
  cached: boolean
}
