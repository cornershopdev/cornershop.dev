import {
  factoryAnalyticsSnippet,
  resolveFactoryAnalytics,
} from "@/lib/factory-analytics";

/**
 * Next inlines `process.env.NEXT_PUBLIC_*` only where it reads as a literal
 * member expression, so the reads stay here and the decision stays testable in
 * `resolveFactoryAnalytics`.
 */
export function FactoryAnalytics() {
  const config = resolveFactoryAnalytics({
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });
  if (!config) return null;

  return (
    <script
      id="factory-analytics"
      dangerouslySetInnerHTML={{ __html: factoryAnalyticsSnippet(config) }}
    />
  );
}
