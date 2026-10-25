// Shared by the live tests: runs the server with a real provider, streams the
// fixture clip at real-time pace and returns the final transcripts.

import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { getProvider } from "../../src/providers/index.ts";
import { createServer } from "../../src/server.ts";

const FRAME_BYTES = 3200; // 100 ms of 16 kHz PCM16
const WAIT_AFTER_AUDIO_MS = 5000;

// The words the fixture clip says, as a provider may write them.
export const FIXTURE_WORDS = ["westminster", "wordsworth", "librivox"];

export async function transcribeFixture(
  t: TestContext,
  provider: string,
  lang?: string,
): Promise<string> {
  const openStream = getProvider(provider)!(process.env);
  const { server, shutdown } = createServer({
    auth: { allowUnauthenticated: true },
    openStream,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(shutdown);
  const { port } = server.address() as AddressInfo;

  const wav = readFileSync(
    new URL("../fixtures/speech-en.wav", import.meta.url),
  );
  const pcm = wav.subarray(wav.indexOf("data") + 8);
  const finals: string[] = [];
  // An error or a close the client did not start, also after ready.
  const problems: string[] = [];
  let closing = false;

  const query = lang === undefined ? "" : `?lang=${encodeURIComponent(lang)}`;
  const ws = new WebSocket(`ws://localhost:${port}/dicta/v1/listen${query}`);
  await new Promise<void>((resolve, reject) => {
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as {
        type: string;
        text?: string;
        final?: boolean;
      };
      if (message.type === "ready") {
        resolve();
      } else if (message.type === "error") {
        problems.push("server sent an error");
        reject(new Error("server sent an error"));
      } else if (message.type === "transcript" && message.final) {
        finals.push(message.text ?? "");
      }
    };
    ws.onclose = (event) => {
      if (!closing) {
        problems.push(`closed: ${event.code}`);
      }
      reject(new Error(`closed: ${event.code}`));
    };
  });

  // At real-time pace, then end the utterance, as push-to-talk does.
  for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
    ws.send(pcm.subarray(i, i + FRAME_BYTES));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  ws.send(JSON.stringify({ type: "end" }));
  await new Promise((resolve) => setTimeout(resolve, WAIT_AFTER_AUDIO_MS));
  closing = true;
  ws.close();

  if (problems.length > 0) {
    throw new Error(problems.join(", "));
  }
  return finals.join(" ").toLowerCase();
}
