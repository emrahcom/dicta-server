import type { OpenStream } from "./provider.ts";

const FINAL_AFTER_MS = 1000;

// Reports the total bytes received as an interim for each frame, and as a final
// after a second without audio. Calls no service.
export const openStubStream: OpenStream = async ({ onTranscript, onError }) => {
  let bytes = 0;
  let finalTimer: NodeJS.Timeout | undefined;

  return {
    sendAudio(chunk) {
      bytes += chunk.length;
      const text = `${bytes} bytes`;
      onTranscript({ text, final: false });
      clearTimeout(finalTimer);
      // An error thrown in a timer would escape to the event loop.
      finalTimer = setTimeout(() => {
        try {
          onTranscript({ text, final: true });
        } catch (err) {
          onError(err instanceof Error ? err : new Error(String(err)));
        }
      }, FINAL_AFTER_MS);
    },
    close() {
      clearTimeout(finalTimer);
    },
  };
};
