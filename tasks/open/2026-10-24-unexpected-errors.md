# Unexpected errors

Contain unexpected errors to their connection, per `architecture.md`
(Unexpected errors, Logging).

- Move the connection handling out of the `handleUpgrade` callback into an
  async function. The callback calls it and catches its promise.
- A caught error: log it with the session id and close that connection with
  `1011`.
- Enable `typescript/no-misused-promises` in `.oxlintrc.json`.
