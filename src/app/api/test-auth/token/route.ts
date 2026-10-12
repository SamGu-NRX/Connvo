/**
 * EVAL-ONLY token endpoint (CALL-PLAN.md D3, task connvo-call-harness-f1).
 *
 * Serves RS256 bearer tokens minted with the harness's local key so the
 * test-only client adapter (src/lib/test-auth.tsx) can authenticate against
 * a local anonymous Convex deployment whose auth.config was extended with
 * the CONNVO_LOCAL_TEST_JWKS provider (D2).
 *
 * This route does not exist in any authorization path on main:
 * - 404 unless NEXT_PUBLIC_CONNVO_TEST_AUTH === "1";
 * - refuses on any Vercel deployment (VERCEL set), whatever the markers;
 * - refuses when NODE_ENV === "production" without the explicit local-build
 *   marker NEXT_PUBLIC_CONNVO_LOCAL_BUILD === "1".
 * The private key is generated and injected only by
 * tools/call-eval/scripts/local-backend.mjs (D1).
 */

import { createPrivateKey, createSign } from "node:crypto";

export const runtime = "nodejs";

const LOCAL_TEST_ISSUER = "https://connvo-local-test.invalid";
const TOKEN_TTL_S = 600;

// Must match convex/devEval/seed.ts (the identities seeded into the local
// deployment) and tools/call-eval/scripts/local-backend.mjs.
const SEED_USERS = {
  A: { subject: "local-test-a", email: "a@connvo-local.test", name: "Alice Anderson" },
  B: { subject: "local-test-b", email: "b@connvo-local.test", name: "Bob Brown" },
  C: { subject: "local-test-c", email: "c@connvo-local.test", name: "Carol Chen" },
  O: { subject: "local-test-o", email: "o@connvo-local.test", name: "Owen Outsider" },
} as const;

type SeedUserKey = keyof typeof SEED_USERS;

function testAuthGuardsFail(): string | null {
  if (process.env.NEXT_PUBLIC_CONNVO_TEST_AUTH !== "1") {
    return "Not found";
  }
  // The local-build marker is for production-mode builds on a developer
  // machine. A deployment that carries it by mistake must still refuse.
  if (process.env.VERCEL) {
    return "[connvo test-auth] refusing: this is a Vercel deployment";
  }
  const reasons: string[] = [];
  if (process.env.VERCEL_ENV === "production") reasons.push("VERCEL_ENV=production");
  if (process.env.NODE_ENV === "production") reasons.push("NODE_ENV=production");
  if (reasons.length > 0 && process.env.NEXT_PUBLIC_CONNVO_LOCAL_BUILD !== "1") {
    return `[connvo test-auth] refusing: production environment (${reasons.join(", ")}) without local-build marker`;
  }
  return null;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function mintToken(privateKeyJson: Record<string, unknown>, claims: object): string {
  const privateKey = createPrivateKey({
    key: privateKeyJson as unknown as import("node:crypto").JsonWebKey,
    format: "jwk",
  });
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: "connvo-local-test-1" }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createSign("RSA-SHA256")
    .update(`${header}.${payload}`)
    .sign(privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

export async function GET(request: Request): Promise<Response> {
  const guard = testAuthGuardsFail();
  if (guard) {
    return new Response(guard, { status: guard === "Not found" ? 404 : 403 });
  }

  const userParam = (new URL(request.url).searchParams.get("user") ?? "A").toUpperCase();
  const user = SEED_USERS[userParam as SeedUserKey];
  if (!user) {
    return new Response(
      `[connvo test-auth] unknown user '${userParam}' (expected one of A, B, C, O)`,
      { status: 400 },
    );
  }

  const keyB64 = process.env.CONNVO_LOCAL_TEST_AUTH_KEY;
  if (!keyB64) {
    return new Response(
      "[connvo test-auth] CONNVO_LOCAL_TEST_AUTH_KEY is not set; start the local backend with pnpm call-eval:backend (D1)",
      { status: 500 },
    );
  }

  let privateKeyJson: Record<string, unknown>;
  try {
    privateKeyJson = JSON.parse(Buffer.from(keyB64, "base64").toString("utf8")) as Record<string, unknown>;
  } catch {
    return new Response("[connvo test-auth] CONNVO_LOCAL_TEST_AUTH_KEY is not a base64 JWK", {
      status: 500,
    });
  }

  const nowS = Math.floor(Date.now() / 1000);
  const aud = process.env.WORKOS_CLIENT_ID || "connvo-local-test";
  const token = mintToken(privateKeyJson, {
    sub: user.subject,
    email: user.email,
    name: user.name,
    iss: LOCAL_TEST_ISSUER,
    aud,
    iat: nowS,
    exp: nowS + TOKEN_TTL_S,
  });

  return Response.json(
    {
      token,
      workosUserId: user.subject,
      email: user.email,
      name: user.name,
      issuer: LOCAL_TEST_ISSUER,
      expiresAt: (nowS + TOKEN_TTL_S) * 1000,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
