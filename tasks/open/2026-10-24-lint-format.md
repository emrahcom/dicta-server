# Linter and formatter

Add Prettier for formatting and Oxlint for linting. TypeScript stays at 7.

- Prettier with its defaults. They match ccs-video-ui-service (double quotes,
  80 columns, trailing commas), so no config file unless one is needed.
- Format the whole repo once.
- Oxlint with its default rules. No `no-console`: the console is the log output
  of this server.
- Try Oxlint's type-aware mode with TypeScript 7. Enable it, with at least
  `no-floating-promises`, only if it works without workarounds. Otherwise leave
  it out and report why.
- npm scripts: `check` (`prettier --check . && tsc`), `format`, `lint`,
  `lint:fix`.
- Add `npm run lint` to the verification commands in `CLAUDE.md`.
