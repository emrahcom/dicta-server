# Product

dicta lets users tell a web application what they want, by typing or by
speaking. dicta turns the input into something the application can act on.

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
  works, but features are driven by what applications need from user input.

## First version

- Authenticated WebSocket connection.
- Audio in, transcripts out: interim results while the user speaks, a final
  result when they stop.
- Mistral and Deepgram as speech-to-text providers, chosen per server.

Turning the text into the application's actions (tool calls) is not part of
dicta-server. `dicta-js` and dicta-server are complete without it: the
application gets the text and handles it itself. Applications that want actions
can add the optional `dicta-action-server`, which takes the text that `dicta-js`
delivers.
