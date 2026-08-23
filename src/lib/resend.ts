import { Resend } from "resend";
import {
  assertFirstCustomerTestModeSafety,
  firstCustomerTestModeEnabled,
} from "@/lib/first-customer-test-mode";

let resend: Resend | undefined;

export function getResend(): Resend {
  if (resend) return resend;
  if (!process.env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured");
  }
  assertFirstCustomerTestModeSafety();
  resend = new Resend(process.env.RESEND_API_KEY, {
    ...(firstCustomerTestModeEnabled()
      ? { baseUrl: process.env.RESEND_API_BASE_URL }
      : {}),
  });
  return resend;
}

export const RESEND_SEND_TIMEOUT_MS = 8_000;

export type BoundedResendEmail = {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html?: string;
  text: string;
  headers?: Record<string, string>;
  tags: Array<{ name: string; value: string }>;
};

/**
 * Sends through Resend's HTTP contract with an abort signal. The SDK version
 * installed here does not expose a request signal and converts network errors
 * into response-shaped values, which cannot safely fence a DB-held pause lock.
 */
export async function sendBoundedResendEmail(
  email: BoundedResendEmail,
  idempotencyKey: string,
): Promise<{
  data: { id: string } | null;
  error: {
    message: string;
    statusCode: number | null;
    name: string | null;
  } | null;
}> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RESEND_SEND_TIMEOUT_MS);
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "cornershopdev-niche-outreach",
      },
      body: JSON.stringify({
        from: email.from,
        to: email.to,
        reply_to: email.replyTo,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: email.headers,
        tags: email.tags,
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as {
      id?: unknown;
      message?: unknown;
      name?: unknown;
    } | null;
    if (response.ok && typeof payload?.id === "string") {
      return { data: { id: payload.id }, error: null };
    }
    return {
      data: null,
      error: {
        message:
          typeof payload?.message === "string"
            ? payload.message
            : "Resend rejected the request.",
        statusCode: response.status,
        name: typeof payload?.name === "string" ? payload.name : null,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
