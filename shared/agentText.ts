export const markers = ["<｜DSML｜", "<|DSML|", "</｜DSML｜", "</|DSML|"];

/** Keep a split protocol prefix out of streamed text, including before its name arrives. */
export function visibleAnswer(text: string, final = false): string {
  const at = markers.reduce((first, marker) => {
    const i = text.indexOf(marker);
    return i < 0 ? first : Math.min(first, i);
  }, text.length);
  if (at < text.length) return text.slice(0, at).trimEnd();
  if (!final) for (let n = Math.min(9, text.length); n > 0; n--) {
    if (markers.some(marker => marker.startsWith(text.slice(-n)))) return text.slice(0, -n);
  }
  return text;
}

