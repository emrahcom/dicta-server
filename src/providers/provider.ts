export type Transcript = { text: string; final: boolean };

export type ProviderStream = {
  sendAudio(chunk: Buffer): void;
  close(): void;
};

// Opens one provider stream for one connection. Transcripts are reported
// through onTranscript until the stream is closed.
export type OpenStream = (onTranscript: (transcript: Transcript) => void) => Promise<ProviderStream>;
