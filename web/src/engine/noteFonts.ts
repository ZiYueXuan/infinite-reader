import { t } from '../i18n/runtime.ts'
import { ensureReaderFont } from '../book/fonts'
import { noteFont } from './noteText'

export async function ensureNoteFont(text: string) {
  if (noteFont(text).cjk) await ensureReaderFont('wenkai', text)
  else await document.fonts.load('600 20px "Caveat Variable"', text || t("Note"))
}
