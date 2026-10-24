# Upgrade robustness

Keep a bad request or a broken socket from crashing the process, per
`architecture.md` (Unexpected errors) and `contract-protocol.md` (Closing).

- Add an `error` listener to the socket at the start of the `upgrade` handler.
- A request URL that cannot be parsed: answer 400 and end the socket.
- In `shutdown()`, wait for each connection's `close` without rejecting on an
  `error` event.
- Tests with a raw socket: a malformed URL gets 400 and the server keeps
  serving; a reset on another path does not crash it.
