// The token check of a connection; see architecture.md (Authentication).

import { errors, jwtVerify } from "jose";

// The WebSocket protocol name; the JWT follows it in Sec-WebSocket-Protocol.
export const PROTOCOL = "dicta";

// The JWT is the entry after "dicta" in the Sec-WebSocket-Protocol header.
export function tokenFromProtocols(header: string | undefined): string | null {
  const entries = header?.split(",").map((entry) => entry.trim()) ?? [];
  const index = entries.indexOf(PROTOCOL);
  return index === -1 ? null : (entries[index + 1] ?? null);
}

type TokenCheck = { ok: true; sub?: string } | { ok: false; reason: string };

export async function checkToken(
  token: string | null,
  secret: Uint8Array,
  audience: string | undefined,
): Promise<TokenCheck> {
  if (!token) {
    return { ok: false, reason: "missing" };
  }
  try {
    // jose checks aud only when audience is given; a list that holds it
    // passes.
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
      audience,
    });
    // jose does not check the type of sub; only a string is logged.
    return {
      ok: true,
      sub: typeof payload.sub === "string" ? payload.sub : undefined,
    };
  } catch (err) {
    return { ok: false, reason: rejectionReason(err) };
  }
}

// Only fixed strings: nothing from an unverified token reaches the log.
function rejectionReason(err: unknown): string {
  if (err instanceof errors.JWTExpired) {
    return "expired";
  }
  if (err instanceof errors.JWSSignatureVerificationFailed) {
    return "invalid signature";
  }
  if (
    err instanceof errors.JWTClaimValidationFailed &&
    err.claim === "exp" &&
    err.reason === "missing"
  ) {
    return "missing exp";
  }
  if (err instanceof errors.JWTClaimValidationFailed && err.claim === "aud") {
    return "wrong aud";
  }
  return "invalid";
}
