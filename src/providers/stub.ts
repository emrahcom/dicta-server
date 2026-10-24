import type { OpenStream } from './provider.ts';

const FINAL_AFTER_MS = 1000;

// Reports the total bytes received as an interim for each frame, and as a final
// after a second without audio. Calls no service.
export const openStubStream: OpenStream = async (onTranscript) => {
  let bytes = 0;
  let finalTimer: NodeJS.Timeout | undefined;

  return {
    sendAudio(chunk) {
      bytes += chunk.length;
      const text = `${bytes} bytes`;
      onTranscript({ text, final: false });
      clearTimeout(finalTimer);
      finalTimer = setTimeout(() => onTranscript({ text, final: true }), FINAL_AFTER_MS);
    },
    close() {
      clearTimeout(finalTimer);
    },
  };
};
