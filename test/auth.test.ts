import assert from "node:assert/strict";
import { test } from "node:test";
import { type JWTPayload, SignJWT } from "jose";
import {
  SECRET,
  listen,
  nextJson,
  nextMessage,
  sign,
  start,
  untilClose,
  untilLogged,
} from "./helpers.ts";

test("answers with the dicta protocol", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign());
  await nextMessage(ws);

  assert.equal(ws.protocol, "dicta");
});

test("sends ready with a session id for a valid token", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign());
  const message = await nextJson(ws);

  assert.equal(message.type, "ready");
  assert.equal(typeof message.sessionId, "string");
  assert.notEqual(message.sessionId, "");
});

// `inUrl` sends the token in the URL instead of Sec-WebSocket-Protocol;
// `audience` starts the server with that JWT_AUDIENCE.
const rejections: {
  name: string;
  token: () => Promise<string | null>;
  reason: string;
  inUrl?: boolean;
  audience?: string;
}[] = [
  { name: "missing", token: async () => null, reason: "missing" },
  {
    name: "only in the URL",
    token: () => sign(),
    reason: "missing",
    inUrl: true,
  },
  {
    name: "signed with another secret",
    token: () => sign({ secret: "other" }),
    reason: "invalid signature",
  },
  {
    name: "expired",
    token: () => sign({ exp: Math.floor(Date.now() / 1000) - 60 }),
    reason: "expired",
  },
  {
    name: "without exp",
    token: () => sign({ exp: null }),
    reason: "missing exp",
  },
  { name: "malformed", token: async () => "not-a-jwt", reason: "invalid" },
  {
    name: "for another aud, with JWT_AUDIENCE set",
    token: () => sign({ aud: "dicta-action" }),
    reason: "wrong aud",
    audience: "dicta",
  },
  {
    name: "without aud, with JWT_AUDIENCE set",
    token: () => sign(),
    reason: "wrong aud",
    audience: "dicta",
  },
];

for (const { name, token, reason, inUrl, audience } of rejections) {
  test(`closes with 4001 and logs the reason when the token is ${name}`, async (t) => {
    const { base, shutdown } = await start({
      auth: { jwtSecret: SECRET, jwtAudience: audience },
    });
    t.after(shutdown);
    const warned = t.mock.method(console, "warn", () => {});

    const value = await token();
    const ws = inUrl
      ? listen(base, null, `?token=${value}`)
      : listen(base, value);

    assert.deepEqual(await untilClose(ws), { messages: [], code: 4001 });
    assert.match(
      warned.mock.calls[0].arguments[0],
      new RegExp(`^\\[[0-9a-f-]+\\] token rejected: ${reason}$`),
    );
  });
}

const audienceAccepted: { name: string; aud: string | string[] }[] = [
  { name: "that aud", aud: "dicta" },
  { name: "a list that holds it", aud: ["other", "dicta"] },
];

for (const { name, aud } of audienceAccepted) {
  test(`sends ready with JWT_AUDIENCE set and a token with ${name}`, async (t) => {
    const { base, shutdown } = await start({
      auth: { jwtSecret: SECRET, jwtAudience: "dicta" },
    });
    t.after(shutdown);

    const ws = listen(base, await sign({ aud }));
    const message = await nextJson(ws);

    assert.equal(message.type, "ready");
  });
}

test("sends ready without JWT_AUDIENCE for a token with any aud", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);

  const ws = listen(base, await sign({ aud: "anything" }));
  const message = await nextJson(ws);

  assert.equal(message.type, "ready");
});

test("logs the close of a rejected connection after the reason", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const warned = t.mock.method(console, "warn", () => {});
  const logged = t.mock.method(console, "log", () => {});

  await untilClose(listen(base, null));
  await untilLogged(logged, 1);

  const tag = warned.mock.calls[0].arguments[0].split(" ")[0];
  assert.equal(
    logged.mock.calls[0].arguments[0],
    `${tag} closed code=4001 audio=0s`,
  );
});

test("logs connected with the sub of the token", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = listen(base, await sign({ sub: "user-1" }));
  const { sessionId } = await nextJson(ws);

  assert.equal(
    logged.mock.calls[0].arguments[0],
    `[${sessionId}] connected sub="user-1"`,
  );
});

test("does not log a sub that is not a string", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  // jose types sub as a string, but accepts any JSON value at runtime.
  const payload = { sub: { email: "a@example.com" } } as unknown as JWTPayload;
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
  const ws = listen(base, token);
  const { sessionId } = await nextJson(ws);

  assert.equal(logged.mock.calls[0].arguments[0], `[${sessionId}] connected`);
});

test("logs connected without sub when the token has none", async (t) => {
  const { base, shutdown } = await start();
  t.after(shutdown);
  const logged = t.mock.method(console, "log", () => {});

  const ws = listen(base, await sign());
  const { sessionId } = await nextJson(ws);

  assert.equal(logged.mock.calls[0].arguments[0], `[${sessionId}] connected`);
});

test("sends ready without a token when unauthenticated is allowed", async (t) => {
  const { base, shutdown } = await start({
    auth: { allowUnauthenticated: true },
  });
  t.after(shutdown);

  const ws = new WebSocket(`${base}/dicta/v1/listen`);
  const message = await nextJson(ws);

  assert.equal(message.type, "ready");
});
