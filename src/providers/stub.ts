import type { OpenStream } from "./provider.ts";

const FINAL_AFTER_MS = 1000;

// Reports the total bytes received as an interim for each frame, and as a final
// when the utterance is finished or after a second without audio. Calls no
// service.
export const openStubStream: OpenStream = async ({ onTranscript, onError }) => {
  let bytes = 0;
  // The text of the current utterance, until it is sent as a final.
  let pending: string | undefined;
  let finalTimer: NodeJS.Timeout | undefined;

  const finish = () => {
    clearTimeout(finalTimer);
    if (pending !== undefined) {
      const text = pending;
      pending = undefined;
      onTranscript({ text, final: true });
    }
  };

  return {
    sendAudio(chunk) {
      bytes += chunk.length;
      pending = `${bytes} bytes`;
      onTranscript({ text: pending, final: false });
      clearTimeout(finalTimer);
      // An error thrown in a timer would escape to the event loop.
      finalTimer = setTimeout(() => {
        try {
          finish();
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }, FINAL_AFTER_MS);
    },
    finish,
    close() {
      clearTimeout(finalTimer);
    },
  };
};
