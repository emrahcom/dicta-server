# Tasks format

One file per task in `tasks/open/`, named `YYYY-MM-DD-slug.md` with the date it
was created. It moves to `tasks/done/` in the commit that implements it.

```
# Short title

Definition.
```

The definition states what to implement and cites the spec section it follows.
Tasks are added one at a time as work progresses.

## Findings

An out-of-scope observation made during a task (a bug, an improvement, a missing
piece) is listed in the reply at the end of the task. It is not implemented and
not written to a file. It becomes a task only when the user asks for one.

Behavior a spec already permits or addresses is not a finding.
