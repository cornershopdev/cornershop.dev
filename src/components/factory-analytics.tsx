import { headers } from "next/headers";
import {
  factoryAnalyticsSnippet,
  resolveFactoryAnalytics,
  type FactoryAnalyticsEvent,
} from "@/lib/factory-analytics";
import { isFactoryHostname } from "@/lib/hostnames";
import { requestHostname } from "@/lib/request-hostname";

/**
 * Read the key from the running container, not the GitHub image build. Next
 * freezes literal `process.env.NEXT_PUBLIC_*` expressions during `next build`;
 * aliasing `process.env` keeps these deliberately public values runtime-bound.
 * The Host check also protects custom-domain rewrites onto `/preview`.
 */
export async function FactoryAnalytics({
  initialEvent,
}: {
  initialEvent?: FactoryAnalyticsEvent;
} = {}) {
  const requestHeaders = await headers();
  if (!isFactoryHostname(requestHostname(requestHeaders))) return null;

  const runtimeEnvironment = process.env;
  const config = resolveFactoryAnalytics({
    NEXT_PUBLIC_POSTHOG_KEY: runtimeEnvironment.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: runtimeEnvironment.NEXT_PUBLIC_POSTHOG_HOST,
  });
  if (!config) return null;

  return (
    <script
      id="factory-analytics"
      dangerouslySetInnerHTML={{
        __html: factoryAnalyticsSnippet(config, initialEvent),
      }}
    />
  );
}
