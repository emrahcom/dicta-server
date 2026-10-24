# Auth logging

Log token rejections and accepted connections, per `architecture.md` (Logging).

- A rejected token: log `token rejected: <reason>`. Reasons: missing, expired,
  invalid signature, missing `exp`, and a generic one for anything else.
- An accepted connection: log `connected`, plus `sub=<sub>` when the token has
  one.
- Log nothing else from the token.
