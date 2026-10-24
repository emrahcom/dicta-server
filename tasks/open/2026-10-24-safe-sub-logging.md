# Safe sub logging

Log `sub` safely and readably, per `architecture.md` (Logging).

- Quote and escape `sub` like a JSON string.
- Escape invisible and control characters as `\uXXXX`, including line and
  paragraph separators, bidi controls and zero-width characters.
- Cut it to 128 characters, followed by `...` when longer.
- Readable values stay as they are, including non-ASCII letters.
