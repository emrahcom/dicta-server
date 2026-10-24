# Product

dicta lets users control a web application by voice. The application registers
its actions, the user speaks, and dicta turns the speech into something the
application can act on.

dicta-server is the server side. It receives a user's microphone audio from
`dicta-js`, sends it to a speech-to-text provider and returns the transcripts.

## What it is

- A WebSocket service. One connection carries one user's audio.
- A gateway to speech-to-text providers. The provider is chosen on the server;
  the browser never sees provider keys.
- Self-hostable. Instances share no state, so any number can run behind a load
  balancer.

## What it is not

- Not a voice assistant or chat bot. It does not talk back.
- Not a media server. No WebRTC, no rooms, no multi-party calls.
- Not a speech-to-text engine. It uses providers, it does not run models.
- Not a general-purpose transcription service. Using it for plain speech-to-text
  works, but features are driven by voice control.

## First version

- Authenticated WebSocket connection.
- Audio in, transcripts out: interim results while the user speaks, a final
  result when they stop.
- One speech-to-text provider.

Later, the server may turn final transcripts into the application's actions
(tool calls) instead of returning text only.
