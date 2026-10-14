import { createHash, timingSafeEqual } from "node:crypto";

const DISTINCT_FROM = [
  "HEALTHCHECK_TOKEN",
  "OPERATOR_LEAD_INGEST_TOKEN",
  "CLAIM_TOKEN_SECRET",
  "BETTER_AUTH_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
] as const;

export function operatorMcpAccessProblem(
  env: Record<string, string | undefined>,
): string | null {
  const token = env.OPERATOR_MCP_TOKEN?.trim() ?? "";
  if (token.length < 32) {
    return "OPERATOR_MCP_TOKEN must contain at least 32 characters.";
  }

  for (const name of DISTINCT_FROM) {
    const other = env[name]?.trim();
    if (other && sameSecret(token, other)) {
      return `OPERATOR_MCP_TOKEN must be distinct from ${name}.`;
    }
  }

  return null;
}

function sameSecret(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}
