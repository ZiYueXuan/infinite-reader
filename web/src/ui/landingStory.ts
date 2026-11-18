import { TILT_DEFAULT, TILT_MIN, TILT_MAX } from '../settings.ts'

/** One shared timeline keeps the model, overlays, copy and chapter navigation in sync. */
export const STORY_CHAPTERS = [
  { id: 'reading', label: 'Reading', title: 'A book. A world. No distractions.', text: 'Watch the cover open and the pages turn. A familiar reading ritual, reimagined for your screen.' },
  { id: 'perspective', label: 'Angle & depth', title: 'A book with another dimension.', text: 'Stay directly in front of the book and adjust the viewing pitch. See the layered page edges and book thickness as you move from a top-down view to a lower angle.' },
  { id: 'appearance', label: 'Fonts & themes', title: 'Make the atmosphere your own.', text: 'Choose your reading typeface and desk theme. Move from a warm reading nook to a quiet, dark desk.' },
  { id: 'highlights', label: 'Highlights', title: 'Keep the lines that stay with you.', text: 'Highlight a passage or underline a sentence. Give a thought a place to return to.' },
  { id: 'markdown', label: 'Live Markdown', title: 'Write Markdown. See it take shape.', text: 'Headings, emphasis, and lists appear as you write inside the inline note. Stay beside the passage, without switching to a preview pane.' },
  { id: 'save', label: 'Auto-save', title: 'Stay with the thought. It is saved.', text: 'Inline notes save as you edit. Signed-in notes sync to your account; sample reading while signed out stays in this browser.' },
  { id: 'conversation', label: 'Agent reading companion', title: 'Meet the agent reading beside you.', text: 'Infinite is your AI reading companion. It finds and reads relevant passages, answers with sources, and follows your questions.' },
  { id: 'mindmap', label: 'Mind maps', title: 'Watch your understanding unfold.', text: 'Turn a passage or chapter into a mind map. Follow the connections between the central idea, its details, and your own questions.' },
  { id: 'atlas', label: '3D atlas', title: 'Step into the places on the page.', text: 'For supported maps in a book, explore locations on a globe and move into a 3D terrain view. Give the story a sense of place.' },
  { id: 'fullscreen', label: 'Fullscreen', title: 'More room for the world inside.', text: 'Expand your browser to fullscreen, or fit the book comfortably to your screen. Settle in and keep reading.' },
] as const
export const STORY_COUNT = STORY_CHAPTERS.length
export const smooth = (a: number, b: number, value: number) => { const n = Math.max(0, Math.min(1, (value - a) / (b - a))); return n * n * (3 - 2 * n) }
export const chapterStop = (index: number) => (Math.max(0, Math.min(STORY_COUNT - 1, index)) + .65) / STORY_COUNT
export const chapterWeight = (index: number, time: number) => smooth(index - .12, index + .18, time) * (1 - smooth(index + .86, index + 1.12, time))
export function storyFrame(progress: number) {
  const time = Math.max(0, Math.min(1, progress)) * STORY_COUNT
  const index = Math.min(STORY_COUNT - 1, Math.floor(time))
  return { time, index, local: time - index }
}
export function bookOpening(time: number) {
  const open = smooth(.08, .65, time)
  return { open }
}

export function bookView(time: number) {
  const weight = chapterWeight(1, time)
  const demonstration = TILT_MIN + (TILT_MAX - TILT_MIN) * smooth(1.18, 1.78, time)
  const tilt = TILT_DEFAULT * (1 - weight) + demonstration * weight
  return { tilt, degrees: Math.round(tilt * 180 / Math.PI), fraction: (tilt - TILT_MIN) / (TILT_MAX - TILT_MIN) }
}
