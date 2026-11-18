import type { DeskId } from '../settings'
import walnut from '../assets/shelf/walnut.webp?url&no-inline'
import ash from '../assets/shelf/ash.webp?url&no-inline'
import ink from '../assets/shelf/ink.webp?url&no-inline'
import baize from '../assets/shelf/baize.webp?url&no-inline'
import stone from '../assets/shelf/stone.webp?url&no-inline'

// Static captures of the existing empty desk: preserve its appearance without
// creating a WebGL context just to browse books. Only the selected image is fetched.
export const SHELF_BACKGROUNDS: Record<DeskId, string> = { walnut, ash, ink, baize, stone }
