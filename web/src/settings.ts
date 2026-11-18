import { DEFAULT_READER_FONT, DEFAULT_QUOTE_FONT, readerFontIdOf, quoteFontIdOf, type ReaderFontId, type QuoteFontId } from './book/fontCatalog.ts'
export const DESK_IDS = ['walnut', 'ash', 'ink', 'baize', 'stone'] as const
export type DeskId = (typeof DESK_IDS)[number]

/** Stable IDs preserve existing preferences while each surface has its own material. */
export interface DeskSurface {
  id: DeskId
  label: string
  /** sRGB colors; the renderer converts the albedo stops to linear RGB. */
  swatch: string
  dark: string
  light: string
  material: 'wood' | 'linen' | 'matte' | 'felt' | 'stone'
  roughness: number
  /** Light surfaces use dark shelf typography. */
  pale: boolean
}

export const DESK_SURFACES: readonly DeskSurface[] = [
  {
    id: 'walnut',
    label: 'Walnut',
    swatch: '#514944',
    // Cool albedo offsets the warm desk lamp, keeping the visible walnut desaturated.
    dark: '#454148',
    light: '#625c63',
    material: 'wood',
    roughness: 0.88,
    pale: false,
  },
  {
    id: 'ash',
    label: 'Linen',
    swatch: '#b7b0a2',
    dark: '#aba79c',
    light: '#c0bcb1',
    material: 'linen',
    roughness: 1,
    pale: true,
  },
  {
    id: 'ink',
    label: 'Graphite',
    swatch: '#363a3b',
    dark: '#3b4852',
    light: '#48555f',
    material: 'matte',
    roughness: 0.96,
    pale: false,
  },
  {
    id: 'baize',
    label: 'Sage',
    swatch: '#93a592',
    dark: '#91aaa5',
    light: '#a0bbb3',
    material: 'felt',
    roughness: 1,
    pale: true,
  },
  {
    id: 'stone',
    label: 'Limestone',
    swatch: '#cccec8',
    dark: '#c8cdd0',
    light: '#dcdfdf',
    material: 'stone',
    roughness: 0.93,
    pale: true,
  },
]

const DESK_BY_ID = Object.fromEntries(DESK_SURFACES.map((s) => [s.id, s])) as Record<DeskId, DeskSurface>

export function isDeskId(value: unknown): value is DeskId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DESK_BY_ID, value)
}

/** Unknown or missing values stay on walnut, the desk this shipped with. */
export function deskIdOf(value: unknown): DeskId {
  return isDeskId(value) ? value : 'walnut'
}

export function deskSurface(id: DeskId): DeskSurface {
  return DESK_BY_ID[id]
}

/** Tinted endpapers, independent of the desk and the EPUB's original cover artwork. */
export const ENDPAPER_SURFACES = [
  { id: 'ivory', label: 'Ivory', swatch: '#dedfdc' },
  { id: 'sand', label: 'Sand', swatch: '#bdbbb5' },
  { id: 'slate', label: 'Slate', swatch: '#718692' },
  { id: 'sage', label: 'Sage', swatch: '#96a99f' },
  { id: 'burgundy', label: 'Burgundy', swatch: '#765863' },
] as const
export type EndpaperId = (typeof ENDPAPER_SURFACES)[number]['id']
export const DEFAULT_ENDPAPER: EndpaperId = 'ivory'

export function endpaperIdOf(value: unknown): EndpaperId {
  return ENDPAPER_SURFACES.find((surface) => surface.id === value)?.id ?? DEFAULT_ENDPAPER
}

export function endpaperSurface(id: EndpaperId) {
  return ENDPAPER_SURFACES.find((surface) => surface.id === id) ?? ENDPAPER_SURFACES[0]
}

export interface Prefs {
  readerFont: ReaderFontId
  quoteFont: QuoteFontId
  /** camera pitch in radians: 0 = looking straight down, larger = more oblique */
  tilt: number
  /** page-turn onboarding hint already shown */
  turnHintSeen: boolean
  /** 'right-drag to tilt' onboarding hint shown / used */
  tiltHintSeen: boolean
  /** desk surface, using the original persisted IDs */
  desk: DeskId
  /** inner cover paper, shared by the front and back boards */
  endpaper: EndpaperId
}

const KEY = 'infinite-reader:prefs:v1'
export const TILT_DEFAULT = 0.44
export const TILT_MIN = 0
export const TILT_MAX = 1.08
export const TILT_PRESETS = [
  { id: 'flat', label: 'Top-down', value: 0.02 },
  { id: 'default', label: 'Default', value: TILT_DEFAULT },
  { id: 'oblique', label: 'Oblique', value: 0.9 },
] as const

const defaults: Prefs = { readerFont: DEFAULT_READER_FONT, quoteFont: DEFAULT_QUOTE_FONT, tilt: TILT_DEFAULT, turnHintSeen: false, tiltHintSeen: false, desk: 'walnut', endpaper: DEFAULT_ENDPAPER }

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...defaults }
    const p = JSON.parse(raw) as Partial<Prefs>
    const tilt = typeof p.tilt === 'number' && isFinite(p.tilt) ? Math.min(TILT_MAX, Math.max(TILT_MIN, p.tilt)) : defaults.tilt
    return { readerFont: readerFontIdOf(p.readerFont), quoteFont: quoteFontIdOf(p.quoteFont), tilt, turnHintSeen: !!p.turnHintSeen, tiltHintSeen: !!p.tiltHintSeen, desk: deskIdOf(p.desk), endpaper: endpaperIdOf(p.endpaper) }
  } catch {
    return { ...defaults }
  }
}

export function savePrefs(patch: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }))
  } catch {
    /* private mode / quota: preferences just won't persist */
  }
}
