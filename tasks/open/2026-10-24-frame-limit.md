# Frame limit

Limit client frames to 64 KiB, per `contract-protocol.md` (Client to server).

- A frame larger than 64 KiB closes the connection with code `1009`.
