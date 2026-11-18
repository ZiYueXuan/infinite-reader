let depth = 0

/** True while a popstate (or an explicit history write) is applying itself to the store. */
export const historyLocked = () => depth > 0

export function runHistoryNav(fn: () => void) {
  depth++
  try {
    fn()
  } finally {
    depth--
  }
}
