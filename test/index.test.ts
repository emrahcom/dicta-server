import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { test } from "node:test";

const SECRET = "s".repeat(32);

function startIndex(env: Record<string, string>) {
  const { JWT_SECRET, ALLOW_UNAUTHENTICATED, PROVIDER, ...rest } = process.env;
  return spawn("node", ["src/index.ts"], {
    env: { ...rest, PORT: "0", ...env },
  });
}

async function exitWithError(env: Record<string, string>): Promise<string> {
  const child = startIndex(env);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  const [code] = await once(child, "exit");

  assert.equal(code, 1);
  return stderr;
}

test("exits at startup without JWT_SECRET", async () => {
  const stderr = await exitWithError({ PROVIDER: "stub" });
  assert.match(stderr, /JWT_SECRET is required/);
});

test("exits at startup without PROVIDER", async () => {
  const stderr = await exitWithError({ JWT_SECRET: SECRET });
  assert.match(stderr, /PROVIDER must be one of: stub/);
});

test("exits at startup with an unknown PROVIDER", async () => {
  const stderr = await exitWithError({
    JWT_SECRET: SECRET,
    PROVIDER: "toString",
  });
  assert.match(stderr, /PROVIDER must be one of: stub/);
});

test("warns at startup when unauthenticated is allowed", async () => {
  const child = startIndex({ ALLOW_UNAUTHENTICATED: "true", PROVIDER: "stub" });
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));

  await once(child.stdout, "data");
  child.kill("SIGTERM");
  await once(child, "exit");

  assert.match(stderr, /ALLOW_UNAUTHENTICATED is on/);
});

test("exits at startup with a JWT_SECRET shorter than 32 bytes", async () => {
  const stderr = await exitWithError({
    JWT_SECRET: "s".repeat(31),
    PROVIDER: "stub",
  });
  assert.match(stderr, /JWT_SECRET must be at least 32 bytes/);
});
