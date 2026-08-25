import { safeExternalHttpsUrlSchema } from "@/lib/verticals/schema";

const UNSAFE_CHARS = /[\\\u0000-\u001f\u007f]/;

/**
 * Deny-by-default destinations for generated article markdown.
 *
 * Safe values are same-origin relative paths, fragment anchors, and the exact
 * HTTPS integration URLs already stored on the published site draft. Protocol-
 * relative, backslash, credentialed, control-character, and any other external
 * href degrade to text instead of becoming an anchor.
 */
export function isSafeArticleHref(
  href: string,
  approvedDestinations: readonly string[] = [],
): boolean {
  if (!href || href !== href.trim() || UNSAFE_CHARS.test(href)) return false;
  if (/\s/.test(href) || /%00/i.test(href)) return false;

  if (href.startsWith("#")) return isSafeFragment(href);
  if (href.startsWith("/") && !href.startsWith("//")) {
    return isSafeSameOriginPath(href);
  }
  return isExactApprovedDestination(href, approvedDestinations);
}

export function approvedArticleDestinations(
  integrations: ReadonlyArray<{ enabled: boolean; url: string }>,
): string[] {
  return [
    ...new Set(
      integrations.flatMap((integration) =>
        integration.enabled &&
        safeExternalHttpsUrlSchema.safeParse(integration.url).success
          ? [integration.url]
          : [],
      ),
    ),
  ];
}

function isSafeFragment(href: string): boolean {
  if (href.length < 2) return false;
  if (href.includes(":") || href.includes("//") || href.includes("@")) {
    return false;
  }
  return true;
}

function isSafeSameOriginPath(href: string): boolean {
  if (href.includes(":") || href.includes("@")) return false;
  return true;
}

function isExactApprovedDestination(
  href: string,
  approvedDestinations: readonly string[],
): boolean {
  if (!safeExternalHttpsUrlSchema.safeParse(href).success) return false;

  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return false;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port
  ) {
    return false;
  }

  return approvedDestinations.some((destination) => {
    if (destination === href) return true;
    try {
      return new URL(destination).href === parsed.href;
    } catch {
      return false;
    }
  });
}
