# dicta-server

## What this is

The server side of dicta, a voice-control layer for web applications. Browsers
running `dicta-js` stream microphone audio over a WebSocket. The server checks
the user's token, forwards the audio to a speech-to-text provider and sends the
transcripts back. It also owns the protocol between `dicta-js` and the server.

## Tech stack

- Node.js (current LTS)
- TypeScript (strict)

Additional libraries are introduced only when a concrete need emerges, not
preemptively. Prefer the standard library or built-in Node APIs when
sufficient.

## Principles

- Keep the project as simple as possible. Avoid speculative complexity and "what
  if we need it later" features.
- Specs in `specs/` are authoritative; code follows specs.
- Specs are living documents. Write only what the next task needs and update
  them whenever needed.
- Atomic, reversible commits with verification at each step.
- Prefer explicit over clever.
- Push back on questionable suggestions; don't agree just to be agreeable.

## Where things live

- `specs/product.md`\
  What the service is and is not
- `specs/architecture.md`\
  How it's built
- `specs/contract-*.md`\
  Integration contracts. `contract-protocol.md` is the protocol between
  `dicta-js` and the server, and the source of truth for both repos.
- `specs/tasks.md`\
  Format conventions for task files
- `tasks/open/`, `tasks/done/`\
  One file per task, named `YYYY-MM-DD-slug.md`. The folder is the status.
- `src/`\
  Implementation
- `test/`\
  Unit tests, mirroring the folders of `src/`

## Verification commands

Not defined yet. Added here once the project skeleton exists.

## Working style

- Raise concerns during implementation rather than silently agreeing.
- Read the relevant spec section before implementing.
- To change behavior, update the spec first, then the code, then tests.
- Make changes small and reversible.
- Verify with the commands above after every change.
- Base claims on a fresh read of the source. Re-open the file or re-run the
  check rather than relying on memory or an earlier read, which may be stale.
  When recording a finding, cite the current source.
- Do only what the task defines. Record out-of-scope observations as finding
  files in `tasks/open/` (per `specs/tasks.md`) rather than implementing them.

## Commits

Subjects start with a type prefix: `feat`, `fix`, `refactor`, `test`, `docs`,
`chore`.

A task lands as up to three commits, one per step, each verified and committed
on its own. Their subjects differ so the log does not read as the same change
twice.

- Spec change\
  `docs:` and a descriptive subject, with no task reference:
  `docs: define the transcript message in contract-protocol.md`. It can land
  before the task file exists.
- Task file\
  `chore: add task 2026-10-24-jwt-auth`
- Implementation\
  The type that fits the change: `feat: implement 2026-10-24-jwt-auth`,
  together with moving the task file from `tasks/open/` to `tasks/done/`.

Subject only, no body and no trailers.
