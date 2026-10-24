// Runs against the real Mistral API, to catch changes on Mistral's side. Not
// part of `npm run test`; run it with `npm run test:live`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { getProvider } from "../../src/providers/index.ts";
import { createServer } from "../../src/server.ts";

const FRAME_BYTES = 3200; // 100 ms of 16 kHz PCM16
const WAIT_AFTER_AUDIO_MS = 5000;

test(
  "transcribes speech with Mistral",
  {
    skip: process.env.MISTRAL_API_KEY ? false : "MISTRAL_API_KEY is not set",
    timeout: 30_000,
  },
  async (t) => {
    const openStream = getProvider("mistral")!(process.env);
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

    const ws = new WebSocket(`ws://localhost:${port}/dicta/v1/listen`);
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
          reject(new Error("server sent an error"));
        } else if (message.type === "transcript" && message.final) {
          finals.push(message.text ?? "");
        }
      };
      ws.onclose = (event) => reject(new Error(`closed: ${event.code}`));
    });

    // At real-time pace, then stop, as push-to-talk does.
    for (let i = 0; i < pcm.length; i += FRAME_BYTES) {
      ws.send(pcm.subarray(i, i + FRAME_BYTES));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await new Promise((resolve) => setTimeout(resolve, WAIT_AFTER_AUDIO_MS));
    ws.close();

    const text = finals.join(" ").toLowerCase();
    for (const word of ["westminster", "wordsworth", "librivox"]) {
      assert.ok(text.includes(word), `"${word}" missing in: ${text}`);
    }
  },
);
