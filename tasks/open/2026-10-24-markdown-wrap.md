# Markdown wrap

Wrap Markdown prose at 80 columns, the same way `deno fmt` does.

- `.prettierrc` with `"proseWrap": "always"`.
- Reformat all Markdown files once.
- `npm run check` then fails on Markdown lines that are not wrapped this way.
