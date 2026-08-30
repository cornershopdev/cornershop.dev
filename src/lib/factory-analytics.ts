/**
 * Product analytics for the public factory funnel, and nowhere else.
 *
 * `proxy.ts` rewrites every verified custom domain onto `/preview/<slug>`, so a
 * pixel mounted in the root layout would ship a third-party script inside the
 * storefronts we publish on customers' own domains. The mount points are named
 * in `factory-analytics.test.ts`; this module only decides whether there is
 * anything to mount at all.
 */
export const FACTORY_ANALYTICS_DEFAULT_HOST = "https://eu.i.posthog.com";

export type FactoryAnalyticsEnvironment = {
  NEXT_PUBLIC_POSTHOG_KEY?: string;
  NEXT_PUBLIC_POSTHOG_HOST?: string;
};

export type FactoryAnalyticsConfig = {
  projectKey: string;
  apiHost: string;
  assetHost: string;
};

/**
 * Returns null — a complete no-op — whenever the project key is absent or the
 * host is unusable. An unconfigured deployment, a fork, and a local checkout all
 * take that path, so the public factory never depends on a key existing.
 */
export function resolveFactoryAnalytics(
  env: FactoryAnalyticsEnvironment,
): FactoryAnalyticsConfig | null {
  const projectKey = env.NEXT_PUBLIC_POSTHOG_KEY?.trim();
  if (!projectKey) return null;

  const configuredHost = env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  const apiHost = normalizeIngestionHost(
    configuredHost && configuredHost.length > 0
      ? configuredHost
      : FACTORY_ANALYTICS_DEFAULT_HOST,
  );
  if (!apiHost) return null;

  return {
    projectKey,
    apiHost,
    assetHost: apiHost.replace(".i.posthog.com", "-assets.i.posthog.com"),
  };
}

/**
 * The vendor snippet is a minified stub whose only job is queueing calls made
 * before `array.js` arrives. Initialising in `onload` needs no queue, so the
 * loader stays readable in a public repository and still guarantees ordering.
 */
export function factoryAnalyticsSnippet(config: FactoryAnalyticsConfig): string {
  const source = JSON.stringify(`${config.assetHost}/static/array.js`);
  const projectKey = JSON.stringify(config.projectKey);
  const options = JSON.stringify({
    api_host: config.apiHost,
    capture_pageview: "history_change",
    person_profiles: "identified_only",
  });
  return [
    "(function(){",
    'var s=document.createElement("script");',
    `s.src=${source};`,
    "s.async=true;",
    's.crossOrigin="anonymous";',
    "s.onload=function(){",
    `if(window.posthog)window.posthog.init(${projectKey},${options});`,
    "};",
    "document.head.appendChild(s);",
    "})();",
  ]
    .join("")
    .replace(/</g, "\\u003c");
}

function normalizeIngestionHost(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.search.length > 0 || url.hash.length > 0) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}
