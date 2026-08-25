export const OWNER_INTEGRATION_TYPES = [
  "booking",
  "ordering",
  "delivery",
  "social",
  "quote",
  "contact",
] as const;

export type OwnerIntegrationType = (typeof OWNER_INTEGRATION_TYPES)[number];

export type OwnerIntegration = {
  type: OwnerIntegrationType;
  label: string;
  provider: string | null;
  url: string;
  enabled: boolean;
  venueId: string | null;
};

export type OwnerIntegrationIssue = {
  path: string;
  message: string;
};

export const OWNER_INTEGRATION_BLANK_MESSAGE =
  "Enter an HTTPS destination before saving this link";
export const OWNER_INTEGRATION_SCHEME_MESSAGE =
  "Integration links must use HTTPS";
export const OWNER_INTEGRATION_PLACEHOLDER_MESSAGE =
  "Use a real customer HTTPS URL, not a placeholder domain";
export const OWNER_INTEGRATION_ENABLE_MESSAGE =
  "Validate an HTTPS destination before showing this link publicly";

export function defaultOwnerIntegrationLabel(
  type: OwnerIntegrationType,
): string {
  switch (type) {
    case "booking":
      return "Book a table";
    case "ordering":
      return "Order online";
    case "delivery":
      return "Get delivery";
    case "social":
      return "Follow us";
    case "quote":
      return "Request a quote";
    case "contact":
      return "Contact us";
  }
}

export function createOwnerIntegration<TType extends OwnerIntegrationType>(input: {
  type: TType;
  label?: string;
}): {
  type: TType;
  label: string;
  provider: null;
  url: string;
  enabled: boolean;
  venueId: null;
} {
  return {
    type: input.type,
    label: input.label ?? defaultOwnerIntegrationLabel(input.type),
    provider: null,
    url: "",
    enabled: false,
    venueId: null,
  };
}

export function isPlaceholderIntegrationHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "");
  return (
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized === "example.net" ||
    normalized.endsWith(".example.net") ||
    normalized === "example.org" ||
    normalized.endsWith(".example.org")
  );
}

export function validateOwnerIntegrationUrl(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return OWNER_INTEGRATION_BLANK_MESSAGE;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return OWNER_INTEGRATION_BLANK_MESSAGE;
  }

  if (parsed.protocol !== "https:") {
    return OWNER_INTEGRATION_SCHEME_MESSAGE;
  }

  if (isPlaceholderIntegrationHostname(parsed.hostname)) {
    return OWNER_INTEGRATION_PLACEHOLDER_MESSAGE;
  }

  return null;
}

export function canEnableOwnerIntegration(url: string): boolean {
  return validateOwnerIntegrationUrl(url) === null;
}

export function withOwnerIntegrationUrl<
  TIntegration extends { url: string; enabled: boolean },
>(integration: TIntegration, url: string): TIntegration {
  return {
    ...integration,
    url,
    enabled: integration.enabled && canEnableOwnerIntegration(url),
  };
}

export function withOwnerIntegrationEnabled<
  TIntegration extends { url: string; enabled: boolean },
>(
  integration: TIntegration,
  enabled: boolean,
): TIntegration & { enabled: boolean } {
  return {
    ...integration,
    enabled: enabled && canEnableOwnerIntegration(integration.url),
  };
}

export function validateOwnerIntegrations(
  integrations: Array<{ url: string; enabled: boolean }>,
): OwnerIntegrationIssue[] {
  const issues: OwnerIntegrationIssue[] = [];
  integrations.forEach((integration, index) => {
    const urlMessage = validateOwnerIntegrationUrl(integration.url);
    if (urlMessage) {
      issues.push({
        path: ownerIntegrationFieldPath(index, "url"),
        message: urlMessage,
      });
    }
    if (integration.enabled && urlMessage) {
      issues.push({
        path: ownerIntegrationFieldPath(index, "enabled"),
        message: OWNER_INTEGRATION_ENABLE_MESSAGE,
      });
    }
  });
  return issues;
}

export function ownerIntegrationFieldPath(
  index: number,
  field: "url" | "enabled" | "label" | "type",
): string {
  return `integrations.${index}.${field}`;
}

export function ownerIntegrationIssueMessage(
  issues: OwnerIntegrationIssue[],
  path: string,
): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

export function zodIssuesToOwnerIssues(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): OwnerIntegrationIssue[] {
  return issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function mergeOwnerDraftIssues(
  preferred: OwnerIntegrationIssue[],
  extra: OwnerIntegrationIssue[],
): OwnerIntegrationIssue[] {
  const seen = new Set(preferred.map((issue) => issue.path));
  return [
    ...preferred,
    ...extra.filter((issue) => !seen.has(issue.path)),
  ];
}

export function formatOwnerDraftIssues(issues: OwnerIntegrationIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${issue.path}: ${issue.message}`)
    .join(" · ");
}
