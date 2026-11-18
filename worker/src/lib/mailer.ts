import { HttpError } from "./util";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

function parseFrom(from: string): { email: string; name?: string } {
  const m = from.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2]!, name: m[1] || undefined };
  return { email: from.trim() };
}

/** Cloudflare Email Service (`send_email` binding). Needs a domain onboarded to Email Sending + Workers Paid. */
class CloudflareMailer implements Mailer {
  constructor(
    private binding: SendEmail,
    private from: string,
  ) {}
  async send(msg: MailMessage) {
    await this.binding.send({
      to: msg.to,
      from: ((f) => (f.name ? { email: f.email, name: f.name } : f.email))(parseFrom(this.from)),
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
  }
}

class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
  ) {}
  async send(msg: MailMessage) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: this.from, to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

/**
 * Picks the mail transport from `EMAIL_PROVIDER` (`cloudflare` | `resend` | `none`).
 * There is deliberately no silent fallback: when nothing is configured, requesting a code fails with 503.
 */
export function getMailer(env: Env): Mailer {
  switch (env.EMAIL_PROVIDER) {
    case "cloudflare":
      if (!env.EMAIL) throw new HttpError(503, "email_not_configured", "send_email binding missing");
      return new CloudflareMailer(env.EMAIL, env.EMAIL_FROM);
    case "resend":
      if (!env.RESEND_API_KEY) throw new HttpError(503, "email_not_configured", "RESEND_API_KEY missing");
      return new ResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM);
    default:
      throw new HttpError(503, "email_not_configured", "Email login is not configured on this deployment");
  }
}

export function emailLoginEnabled(env: Env): boolean {
  return (
    (env.EMAIL_PROVIDER === "cloudflare" && !!env.EMAIL) || (env.EMAIL_PROVIDER === "resend" && !!env.RESEND_API_KEY)
  );
}

export function loginEmail(appName: string, code: string, ttlMin: number): MailMessage & { to: "" } {
  return {
    to: "",
    subject: `${code} is your ${appName} sign-in code`,
    text: `Your ${appName} sign-in code is ${code}\n\nIt expires in ${ttlMin} minutes. If you didn't request it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your ${appName} sign-in code:</p><p style="font-size:32px;letter-spacing:6px;font-weight:700">${code}</p><p style="color:#666">It expires in ${ttlMin} minutes. If you didn't request it, you can ignore this email.</p></div>`,
  };
}
