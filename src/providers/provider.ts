export type Transcript = { text: string; final: boolean };

export type ProviderStream = {
  sendAudio: (chunk: Buffer) => void;
  close: () => void;
};

export type StreamEvents = {
  onTranscript: (transcript: Transcript) => void;
  // A failure after the stream is open. A failure while opening rejects the
  // promise of OpenStream instead.
  onError: (error: Error) => void;
  // Something worth a log line that does not end the stream. Never content
  // such as audio, transcripts or provider messages (architecture.md).
  onWarning: (warning: string) => void;
};

// Opens one provider stream for one connection. Events are reported until the
// stream is closed.
export type OpenStream = (events: StreamEvents) => Promise<ProviderStream>;
