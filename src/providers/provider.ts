export type Transcript = { text: string; final: boolean };

export type ProviderStream = {
  sendAudio: (chunk: Buffer) => void;
  // Ends the current utterance: what the provider has comes as a final.
  finish: () => void;
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

export type StreamOptions = {
  // The client's language as a well-formed BCP 47 tag, when it gave one.
  lang?: string;
};

// Opens one provider stream for one connection. Events are reported until the
// stream is closed.
export type OpenStream = (
  events: StreamEvents,
  options: StreamOptions,
) => Promise<ProviderStream>;

// More audio than this waiting in a provider socket means the provider does
// not keep up, and the stream fails (architecture.md, Providers).
export const MAX_PROVIDER_BUFFER_BYTES = 1024 * 1024;
