# dicta-server

The server side of dicta, a voice-control layer for web applications. Browsers
running `dicta-js` stream microphone audio over a WebSocket. The server checks
the user's token, forwards the audio to a speech-to-text provider and sends the
transcripts back.

Node.js (current LTS) and TypeScript (strict).

## Specs and tasks

- `specs/` is authoritative; code follows it. Specs are living documents: write
  only what the next task needs and update them whenever needed.
- `specs/contract-protocol.md` is the protocol between `dicta-js` and the
  server, and the source of truth for both repos.
- Tasks are files in `tasks/open/` and `tasks/done/`, named
  `YYYY-MM-DD-slug.md`. The folder is the status. `specs/tasks.md` defines the
  format, including how findings are handled.

## Verification commands

Run them after every change.

- Format and type check: `npm run check`
- Lint: `npm run lint`
- Tests: `npm run test`

`npm run format` fixes formatting.

Optional, against the real provider APIs: `npm run test:live` with
`MISTRAL_API_KEY` and `DEEPGRAM_API_KEY` set. A provider without its key is
skipped. Run it before a release or when a provider may have changed.

## Commits

Type prefix (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`), subject only,
no body, no trailers. A task lands as up to three commits:

- `docs: <spec change>`
- `chore: add task 2026-10-24-jwt-auth`
- `<type>: implement 2026-10-24-jwt-auth`, with the type that fits the change.
  It also moves the task file to `tasks/done/`.
