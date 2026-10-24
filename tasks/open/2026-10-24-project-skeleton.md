# Project skeleton

Set up an empty Node.js and TypeScript project, per `CLAUDE.md`.

- npm as the package manager.
- Run TypeScript directly with Node's built-in type stripping. No build step.
- `tsconfig.json` with `strict` and `erasableSyntaxOnly`, used only for type
  checking.
- Tests with Node's built-in test runner (`node --test`).
- npm scripts: `start`, `check` (type check), `test`.
- `src/index.ts` that only starts and logs one line, with one test for it.
- Fill in the verification commands in `CLAUDE.md`.
