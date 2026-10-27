# Maximum for MAX_CONNECTION_MINUTES

Accept `MAX_CONNECTION_MINUTES` only from `1` to `1440`, per `architecture.md`
(Configuration).

- `index.ts` exits at startup with an error naming the range for any other
  value.
- Docs: `docs/settings.md` names the range.
- Tests in `test/index.test.ts`: `0`, `1.5`, `abc` and `1441` exit at startup
  with the error; `1440` starts. The tests remove `MAX_CONNECTION_MINUTES` from
  the inherited environment, like the other settings.
