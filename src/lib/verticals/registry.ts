import { Vertical } from "@/generated/prisma/enums";
import { beautyConfig } from "@/lib/verticals/beauty/config";
import { foodRetailConfig } from "@/lib/verticals/food-retail/config";
import { localServiceConfig } from "@/lib/verticals/local-service/config";
import { restaurantConfig } from "@/lib/verticals/restaurant/config";
import { applyOwnerOperationInvariants } from "@/lib/owner-operations";
import type {
  VerticalConfig,
  VerticalId,
  VerticalOwnerOperations,
} from "@/lib/verticals/types";

/**
 * Variance-erased on purpose: `VerticalConfig` is contravariant in TAttributes —
 * `templates.resolve`, `normalizeGeneratedAttributes`, `rendererCapabilities` and
 * `presentation.buildEyebrow` all *consume* them — so a concrete per-vertical
 * config is not assignable to the abstract type, and the union that appears once a
 * second vertical registers is not callable. Every caller that only knows a
 * `Vertical` value at runtime (the import route, the workflow, the renderer) goes
 * through `resolveVerticalConfig` and gets this erased surface, which keeps the
 * erasure in one documented place instead of at each call site.
 *
 * It still forces every registry entry to be structurally a `VerticalConfig` even
 * if its own module drops its `satisfies` clause.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ErasedVerticalConfig = VerticalConfig<any, any, any, any>;

const registry = {
  [Vertical.RESTAURANT]: restaurantConfig,
  [Vertical.BEAUTY]: beautyConfig,
  [Vertical.LOCAL_SERVICE]: localServiceConfig,
  [Vertical.FOOD_RETAIL]: foodRetailConfig,
} satisfies Record<VerticalId, ErasedVerticalConfig>;

/**
 * The only way to get a config from a runtime `Vertical` value. It deliberately
 * returns the erased surface rather than the union of registered configs: while
 * restaurant was the sole vertical, a union-typed lookup handed back the concrete
 * restaurant type, so a caller could bind to restaurant specifics and still
 * compile. Registering beauty collapsed that to a union and turned every such
 * binding into a build error at once. Erasing here means a call site can only ever
 * use the shared contract, so vertical #3 costs nothing. Anything that genuinely
 * needs a vertical's specifics imports that vertical's config module directly.
 */
export function resolveVerticalConfig(id: VerticalId): ErasedVerticalConfig {
  return registry[id];
}

/**
 * Applies the same catalog visibility capability as the storefront renderer.
 * Stored attribute bags are parsed through the owning vertical first; malformed
 * legacy/direct-DB values fail closed instead of reaching a vertical predicate.
 */
export function isVerticalCatalogItemVisible(
  id: VerticalId,
  item: { available: boolean | null; attributes: unknown },
): boolean {
  const config = resolveVerticalConfig(id);
  const parsedAttributes = config.itemAttributesSchema.safeParse(item.attributes);
  if (!parsedAttributes.success) return false;
  return (
    config.presentation.isItemVisible?.({
      available: item.available,
      attributes: parsedAttributes.data,
    }) ?? item.available !== false
  );
}

export function listVerticalIds(): VerticalId[] {
  return Object.keys(registry) as VerticalId[];
}

/**
 * The niche's URL segment and the value carried on a lead: the enum member
 * lowercased, so `RESTAURANT` is `restaurant`. Derived rather than declared —
 * a config cannot drift from its own slug, and a new vertical gets one for free.
 */
export function verticalSlug(id: VerticalId): string {
  return id.toLowerCase();
}

/**
 * The niche's own folder inside the shared asset bucket. `assets.cornershop.dev`
 * holds every niche's images, so an object key has to name the niche that wrote
 * it — otherwise two niches that both generated a site called `luigi` would
 * write over each other, and no operator looking at the bucket could tell whose
 * files were whose.
 *
 * Derived from the niche's public domain with the separators dropped, so
 * restofront.com owns `restofrontcom/`: the folder reads as the storefront it
 * belongs to rather than as an internal enum member. An unlaunched niche has no
 * domain and falls back to its slug, which is the only stable name it has; when
 * it later gets a domain, objects already written keep their stored URLs, since
 * keys are only ever composed at write time.
 */
export function verticalAssetNamespace(id: VerticalId): string {
  const { domain } = resolveVerticalConfig(id).marketing;
  return (domain ?? verticalSlug(id)).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * The inverse, for a slug that arrived from a URL or a form field and is
 * therefore untrusted. Returns null rather than throwing so callers decide
 * between a 404 and a silent fall back to the default vertical.
 */
export function resolveVerticalBySlug(slug: string): VerticalId | null {
  const wanted = slug.trim().toLowerCase();
  return listVerticalIds().find((id) => verticalSlug(id) === wanted) ?? null;
}

/**
 * Which niche, if any, owns a request's hostname. This is what makes a new niche
 * domain — nails, barbers, dog grooming — a config entry and a DNS record rather
 * than a new route: `proxy.ts` asks this question and rewrites to the shared
 * niche page. Derived from the registry for the same reason as
 * `listEmbedFrameOrigins`: there is no second list of domains to keep in sync,
 * and a hostname nobody registered can never be served as a niche.
 *
 * The port is stripped so `nails.localhost:3000` matches in development.
 */
export function resolveVerticalByHostname(hostname: string): VerticalId | null {
  const wanted = hostname.trim().toLowerCase().split(":")[0];
  if (!wanted) return null;
  for (const id of listVerticalIds()) {
    if (!isVerticalPubliclyLaunched(id)) continue;
    // Through the erased surface, not `registry[id]`: indexing with a runtime id
    // yields the union of the concrete configs, and `includes` on a union of array
    // types demands an argument assignable to every element type at once — which
    // is `never` the moment one vertical registers no hostnames.
    if (resolveVerticalConfig(id).marketing.hostnames.includes(wanted))
      return id;
  }
  return null;
}

/**
 * A registered vertical is not automatically reachable from the public niche
 * route. This explicit flag preserves factory-hosted verticals such as Beauty,
 * which are public before they own a standalone domain, while keeping work in
 * private review unreachable.
 */
export function isVerticalPubliclyAccessible(id: VerticalId): boolean {
  return resolveVerticalConfig(id).marketing.publiclyAccessible;
}

/**
 * Standalone launch is stricter than factory-route access: it requires a real
 * canonical domain, a matching routed hostname and a niche-specific sender.
 */
export function isVerticalPubliclyLaunched(id: VerticalId): boolean {
  return verticalLaunchReadiness(id).ready;
}

export type VerticalLaunchReadiness = {
  ready: boolean;
  issues: Array<
    "public-access" | "domain" | "sender" | "hostname" | "sender-domain"
  >;
};

export function verticalLaunchReadiness(
  id: VerticalId,
): VerticalLaunchReadiness {
  const { domain, email, hostnames } = resolveVerticalConfig(id).marketing;
  const issues: VerticalLaunchReadiness["issues"] = [];
  if (!isVerticalPubliclyAccessible(id)) issues.push("public-access");
  if (!domain) issues.push("domain");
  if (!email) issues.push("sender");
  if (domain && !hostnames.includes(domain)) issues.push("hostname");
  if (
    domain &&
    email &&
    [email.from, email.replyTo].some((value) => {
      const emailDomain = value.match(/@([^>\s]+)>?$/)?.[1]?.toLowerCase();
      return (
        !emailDomain ||
        (emailDomain !== domain && !emailDomain.endsWith(`.${domain}`))
      );
    })
  ) {
    issues.push("sender-domain");
  }
  return { ready: issues.length === 0, issues };
}

/**
 * Claim invitations and checkout are an explicit product capability. A niche
 * claim still requires the niche's complete launch contract; a factory claim
 * uses Cornershopdev's verified runtime sender and the platform subdomain.
 */
export function isVerticalClaimEnabled(id: VerticalId): boolean {
  const mode = resolveVerticalConfig(id).claimMode;
  if (mode === "disabled") return false;
  return mode === "factory" || isVerticalPubliclyLaunched(id);
}

/**
 * Dedicated owner-review dashboards currently exist for restaurant,
 * food-retail and local-service. Beauty still uses UnsupportedVerticalDashboard.
 */
export function isVerticalOwnerReviewSupported(id: VerticalId): boolean {
  return (
    id === Vertical.RESTAURANT ||
    id === Vertical.FOOD_RETAIL ||
    id === Vertical.LOCAL_SERVICE
  );
}

/**
 * Whether an already-published snapshot may be rendered. Independent of
 * whether owners may create or roll back snapshots.
 */
export function isVerticalPublicationEnabled(id: VerticalId): boolean {
  return resolveVerticalConfig(id).publicationEnabled;
}

/**
 * Owner publish/rollback. Fail closed unless the vertical both opts in and
 * ships a supported owner-review workflow — otherwise a preview-only
 * vertical could inherit mutation from a leftover config flag.
 */
export function isVerticalPublicationMutationEnabled(id: VerticalId): boolean {
  const config = resolveVerticalConfig(id);
  return (
    config.publicationMutationEnabled && isVerticalOwnerReviewSupported(id)
  );
}

/**
 * Owner-workspace capabilities as declared on the vertical, fail-closed against
 * claim and publication-mutation gates. Callers must not infer this from which
 * dashboard component is mounted.
 */
export function resolveOwnerOperations(
  id: VerticalId,
): VerticalOwnerOperations {
  return applyOwnerOperationInvariants(
    resolveVerticalConfig(id).ownerOperations,
    {
      claimEnabled: isVerticalClaimEnabled(id),
      publicationMutationEnabled: isVerticalPublicationMutationEnabled(id),
    },
  );
}

/** Every vertical intentionally exposed by the shared public niche route. */
export function listPublicVerticals(): VerticalId[] {
  return listVerticalIds().filter(isVerticalPubliclyAccessible);
}

/**
 * Every launched niche for the factory homepage. A registered vertical can stay
 * private while its positioning and storefront are still being developed; a
 * routed public domain and a dedicated sender are the launch gate. Sorting by
 * the niche's own brand name keeps the order independent of registration order.
 */
export function listMarketingVerticals(): VerticalId[] {
  return listVerticalIds()
    .filter(isVerticalPubliclyLaunched)
    .sort((a, b) =>
      resolveVerticalConfig(a).marketing.brand.name.localeCompare(
        resolveVerticalConfig(b).marketing.brand.name,
      ),
    );
}

/**
 * Every origin any registered vertical may frame a booking widget from, derived
 * from the provider tables themselves. The site CSP is built from this, so a
 * vertical that adds a widget provider extends the allow-list by registering —
 * there is no second list to keep in sync, and nothing outside a provider table
 * can ever be framed.
 */
export function listEmbedFrameOrigins(): string[] {
  const origins = new Set<string>();
  for (const config of Object.values(registry) as ErasedVerticalConfig[]) {
    for (const provider of config.providers) {
      if (provider.embed) origins.add(provider.embed.origin);
    }
  }
  return [...origins].sort();
}
