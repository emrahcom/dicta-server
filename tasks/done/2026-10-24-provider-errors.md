# Provider errors

Handle provider failures, per `architecture.md` (Providers) and
`contract-protocol.md` (`error`).

- Let a provider stream report a failure after it is open.
- When opening fails or an open stream fails: log the details, send a generic
  `error`, close with `1011` and close the provider stream.
- No `ready` when opening fails.
- Other connections and the process are not affected.
