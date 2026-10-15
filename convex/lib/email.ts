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
}

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
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
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
      // Transient failures throw so the scheduled action retries; a refused
      // message (bad address, unverified sender, exhausted credits) is logged
      // and dropped — retrying a 4xx would only spam the logs.
      if (response.status === 429 || response.status >= 500) {
        throw new Error(
          `Resend returned ${response.status}; the send will be retried`,
        );
      }
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        console.error(
          `[email:resend] dropped message to ${message.to}: ${response.status} ${body}`,
        );
        return;
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
