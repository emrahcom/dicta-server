import type { OpenStream } from "./provider.ts";

// Reports the total bytes received as an interim for each frame, and as a final
// when the server finishes the utterance. Calls no service.
export const openStubStream: OpenStream = async ({ onTranscript }) => {
  let bytes = 0;
  // The text of the current utterance, until it is sent as a final.
  let pending = "";

  return {
    sendAudio(chunk) {
      bytes += chunk.length;
      pending = `${bytes} bytes`;
      onTranscript({ text: pending, final: false });
    },
    finish() {
      const text = pending;
      pending = "";
      onTranscript({ text, final: true });
    },
    close() {},
  };
};
