/**
 * The email provider interface for matcher emails
 * (docs/plan/MATCHING-PLAN.md, steps 3-4).
 *
 * One small interface, two implementations: Resend when RESEND_API_KEY is set
 * in the Convex environment, and a console logger otherwise, so dev and CI
 * need no key and no external service. Every matcher email — a new
 * introduction, the confirmation with its .ics, the 24-hour and 10-minute
 * reminders — goes through `sendEmail`, so a deployment flips to real email
 * by setting one environment variable.
 *
 * Only actions may send: fetch is unavailable in mutations and queries, so
 * callers build the message content transactionally and schedule
 * internal.emails.deliver.deliverEmail (convex/emails/deliver.ts).
 */

export interface EmailAttachment {
  filename: string;
  /** Base64-encoded content (Resend's attachment format). */
  base64: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment?: EmailAttachment;
  /**
   * Stable key naming this logical message across retries, passed to Resend
   * as its Idempotency-Key header (resend.com/docs: POST /emails, keys
   * expire after 24 hours, duplicates return the original response), so a
   * retry after an ambiguous failure — the send landed, the response was
   * lost — cannot double-send.
   */
  idempotencyKey?: string;
}

/**
 * A transient provider failure — 429, 5xx, or a network-level error — that a
 * later attempt of the same logical message may survive.
 */
export class TransientSendError extends Error {}

/**
 * A refusal (4xx other than 429): the request itself was rejected, so a
 * retry cannot succeed. It throws rather than returning so the caller's
 * idempotency marker is recorded as failed, never as sent.
 */
export class RefusedSendError extends Error {}

export interface EmailProvider {
  readonly name: "resend" | "console";
  send(message: EmailMessage): Promise<void>;
}

/** Resend's sandbox "from" when no verified sender is configured. */
const DEFAULT_FROM = "Connvo <onboarding@resend.dev>";

/** Provider selection: Resend when a key exists in the Convex environment. */
export function selectEmailProvider(env: {
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}): EmailProvider {
  if (env.RESEND_API_KEY) {
    return resendProvider(env.RESEND_API_KEY, env.EMAIL_FROM ?? DEFAULT_FROM);
  }
  return consoleProvider();
}

export function resendProvider(apiKey: string, from: string): EmailProvider {
  return {
    name: "resend",
    send: async (message) => {
      let response: Response;
      try {
        response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            ...(message.idempotencyKey
              ? { "Idempotency-Key": message.idempotencyKey }
              : {}),
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            ...(message.attachment
              ? {
                  attachments: [
                    {
                      filename: message.attachment.filename,
                      content: message.attachment.base64,
                    },
                  ],
                }
              : {}),
          }),
        });
      } catch (error) {
        // Network-level failure (DNS, refused connection, reset): the send
        // may or may not have reached Resend, so it is transient by
        // definition — retry later under the same idempotency key.
        throw new TransientSendError(
          `Resend request failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      // Transient failures (429, 5xx) throw TransientSendError so the deliver
      // action's own scheduled retry picks them up — Convex does not retry
      // actions on its own. A refused message (bad address, unverified
      // sender, an invalid Idempotency-Key) throws RefusedSendError: it is
      // not retried, but it must not settle as if the person got the email.
      if (response.status === 429 || response.status >= 500) {
        throw new TransientSendError(`Resend returned ${response.status}`);
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new RefusedSendError(
          `Resend returned ${response.status} for ${message.to}: ${body}`,
        );
      }
    },
  };
}

export function consoleProvider(): EmailProvider {
  return {
    name: "console",
    send: async (message) => {
      const lines = [
        `[email:console] provider=console (set RESEND_API_KEY to send for real)`,
        `[email:console] to: ${message.to}`,
        `[email:console] subject: ${message.subject}`,
        ...(message.attachment
          ? [`[email:console] attachment: ${message.attachment.filename}`]
          : []),
        `[email:console] ---`,
        ...message.text.split("\n").map((line) => `[email:console] ${line}`),
      ];
      console.log(lines.join("\n"));
    },
  };
}
