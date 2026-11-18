# Browse inline notes by tag

In reading mode, clicking an inline note's `#tag` opens a modal covering the full reading area. It shows all matching annotations from the **current book**, ordered by chapter and original-text position. Matching uses the existing case-insensitive tag identity, so `quote` and `Quote` appear together. Each entry includes the chapter, full saved source quote, full note text, all tags, and a return-to-source action. The note editor retains tag renaming/removal behavior.

The view reads the current annotation state, including edits not yet synchronized. It does not call AI, refetch annotations, or write data. Book IDs are checked explicitly. The modal suspends reading gestures, supports Escape and keyboard navigation, and restores focus to the originating tag when available.

Tag identities travel with the note's laid-out words, preserving the existing text layout, wrapping and cross-page continuation. Separate transparent buttons are projected onto the rendered tag ink above the existing note-edit hit target. Note-body hashtags remain ordinary text. Note words retain `-1` source offsets so tags never enter source selection or citations.

Validation: inline-note paginator tests cover tag identity across line/page wrapping; `web/scripts/check-note-tags.mjs` uses the local sample, actual projected hit targets and real reader navigation to check matching, book isolation, safe text, focus, full-screen/mobile layout, and source jumps. `check-inline-notes.mjs` covers editing, rendering, persistence and font selection.
