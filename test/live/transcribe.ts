// Shared by the live tests: runs the server with a real provider and sends
// several utterances on one connection, each ended with `end`, as push-to-talk
// does. Returns the finals in order.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { TestContext } from "node:test";
import { getProvider } from "../../src/providers/index.ts";
import { createServer } from "../../src/server.ts";

const FRAME_BYTES = 3200; // 100 ms of 16 kHz PCM16
const FINAL_TIMEOUT_MS = 10_000;
// After the last utterance, how long to wait for a final that should not come.
const EXTRA_FINAL_WAIT_MS = 2000;

const wav = readFileSync(new URL("../fixtures/speech-en.wav", import.meta.url));
const clip = wav.subarray(wav.indexOf("data") + 8);
const silence = Buffer.alloc(2 * 32000); // 2 seconds

// The clip twice, then silence only, then `end` with no audio. Each must get
// exactly one final: the clip's words, the clip's words, empty, empty.
export const UTTERANCES = [clip, clip, silence, Buffer.alloc(0)];

// The words the fixture clip says, as a provider may write them.
export const FIXTURE_WORDS = ["westminster", "wordsworth", "librivox"];

export async function transcribeUtterances(
  t: TestContext,
  provider: string,
  lang?: string,
): Promise<string[]> {
  const openStream = getProvider(provider)!(process.env);
  const { server, shutdown } = createServer({
    auth: { allowUnauthenticated: true },
    openStream,
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  t.after(shutdown);
  const { port } = server.address() as AddressInfo;

  const finals: string[] = [];
  let onFinal = () => {};
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
        finals.push((message.text ?? "").toLowerCase());
        onFinal();
      }
    };
    ws.onclose = (event) => {
      if (!closing) {
        problems.push(`closed: ${event.code}`);
      }
      reject(new Error(`closed: ${event.code}`));
    };
  });

  for (const [index, audio] of UTTERANCES.entries()) {
    // At real-time pace, then end the utterance.
    for (let i = 0; i < audio.length; i += FRAME_BYTES) {
      ws.send(audio.subarray(i, i + FRAME_BYTES));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    ws.send(JSON.stringify({ type: "end" }));
    // Wait for this utterance's final before the next one.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FINAL_TIMEOUT_MS);
      onFinal = () => {
        if (finals.length > index) {
          clearTimeout(timer);
          resolve();
        }
      };
      onFinal();
    });
  }
  await new Promise((resolve) => setTimeout(resolve, EXTRA_FINAL_WAIT_MS));
  closing = true;
  ws.close();

  if (problems.length > 0) {
    throw new Error(problems.join(", "));
  }
  return finals;
}

// Checks that every utterance got exactly one final with the expected text.
export function checkFinals(finals: string[]) {
  const all = JSON.stringify(finals);
  assert.equal(finals.length, UTTERANCES.length, `finals: ${all}`);
  for (const final of finals.slice(0, 2)) {
    for (const word of FIXTURE_WORDS) {
      assert.ok(final.includes(word), `"${word}" missing in: ${all}`);
    }
  }
  assert.deepEqual(finals.slice(2), ["", ""], `finals: ${all}`);
}
