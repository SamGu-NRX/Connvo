/**
 * The deployment's public URL, for links inside emails.
 *
 * Every email link (the join page, the home screen) is built from exactly
 * one function: `configuredAppUrl`. When the deployment sends real email
 * (RESEND_API_KEY set), a missing or loopback CONNVO_APP_URL would mail
 * http://localhost:3000 links to real people, so `realEmailAppUrlRefusal`
 * names the problem before anything goes out.
 *
 * Documented for local runs in convex/README.md:
 *   npx convex env set CONNVO_APP_URL http://localhost:3000
 */

export interface AppUrlEnv {
  CONNVO_APP_URL?: string;
}

/** The fallback URL when CONNVO_APP_URL is unset — a local dev server. */
export const DEFAULT_APP_URL = "http://localhost:3000";

/**
 * The one configured app URL: CONNVO_APP_URL, or the local default. Callers
 * may inject a vars object (the deliver path passes the same env object it
 * runs its refusal check on); without one the Convex environment's
 * `process.env` is read.
 */
export function configuredAppUrl(env?: AppUrlEnv): string {
  const vars = env ?? (process.env as unknown as AppUrlEnv);
  return vars.CONNVO_APP_URL ?? DEFAULT_APP_URL;
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".localhost")
  );
}

/**
 * Why real email must not go out with the current app URL, or null when the
 * links are safe. Only applies when RESEND_API_KEY is set — the local
 * no-key provider is supposed to point at localhost. Checked per send in
 * convex/emails/deliver.ts; the refusal is a RefusedSendError, so the
 * recipient's marker settles as failed and the send is never retried.
 */
export function realEmailAppUrlRefusal(
  env: AppUrlEnv & { RESEND_API_KEY?: string },
): string | null {
  if (!env.RESEND_API_KEY) return null;
  const raw = env.CONNVO_APP_URL;
  if (!raw) {
    return `CONNVO_APP_URL is not set, so email links would point at ${DEFAULT_APP_URL}. Set it to this deployment's public address, e.g. npx convex env set CONNVO_APP_URL https://app.example.com`;
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return `CONNVO_APP_URL (${raw}) is not an absolute URL. Set it to this deployment's public address, e.g. npx convex env set CONNVO_APP_URL https://app.example.com`;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return `CONNVO_APP_URL (${raw}) must be an http(s) URL. Set it to this deployment's public address, e.g. npx convex env set CONNVO_APP_URL https://app.example.com`;
  }
  if (isLoopbackHost(parsed.hostname)) {
    return `CONNVO_APP_URL (${raw}) points at a loopback address, so every recipient would receive localhost links. Set it to this deployment's public address, e.g. npx convex env set CONNVO_APP_URL https://app.example.com`;
  }
  return null;
}
