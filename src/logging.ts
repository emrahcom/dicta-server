const MAX_LENGTH = 128;
const GRAPHEMES = new Intl.Segmenter();

// \p{C} covers control and invisible characters: C0 and C1 controls, bidi
// controls, zero-width characters and other format characters. U+2028 and
// U+2029 are separators, not \p{C}, but they break lines too.
const UNSAFE = /[\p{C}\u2028\u2029]/gu;

// Quotes a value for a log line so it can neither break the line nor hide what
// it contains. Readable characters, including non-ASCII letters, stay as they
// are.
export function quoteForLog(value: string): string {
  // Characters as the reader sees them, so a cut never splits one.
  const chars = Array.from(GRAPHEMES.segment(value), (part) => part.segment);
  const cut = chars.length > MAX_LENGTH;
  const kept = cut ? chars.slice(0, MAX_LENGTH).join("") : value;
  const quoted = JSON.stringify(kept).replace(UNSAFE, (char) =>
    char
      .split("")
      .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join(""),
  );
  return cut ? `${quoted}...` : quoted;
}
