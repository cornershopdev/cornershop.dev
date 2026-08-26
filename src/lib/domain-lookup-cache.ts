import {
  hasPublicPublishedSnapshot,
  type PlatformSubdomainSite,
  type PublishedDomainRecord,
} from "@/lib/domain-routing";

type CacheEntry = {
  expiresAt: number;
  records: PublishedDomainRecord[];
};

const DEFAULT_TTL_MS = 5_000;
const MAX_ENTRIES = 512;

/**
 * A row that is not yet publicly serving is one publish or one domain
 * verification away from changing, and both of those are owner actions with the
 * owner watching the result. Caching such a row would keep 404ing the site for
 * the whole TTL right after the owner acts, so only settled, serving rows enter
 * either cache.
 *
 * An empty/absent result is still cached: that is the unknown-hostname flood
 * guard, and a site or domain row appearing is not a hot loop.
 */
function isCacheableSite(
  site: PublishedDomainRecord["site"] | PlatformSubdomainSite,
): boolean {
  return hasPublicPublishedSnapshot(site);
}

/**
 * Short-lived process cache for custom-domain hostname → site resolution.
 * Proxy hits the same hot hostnames repeatedly; five seconds cuts DB QPS without
 * making TLS/domain detach feel sticky for long.
 */
const cache = new Map<string, CacheEntry>();

type PlatformCacheEntry = {
  expiresAt: number;
  site: PlatformSubdomainSite | null;
};

const platformCache = new Map<string, PlatformCacheEntry>();

function cacheKey(hostnames: string[]): string {
  return hostnames.slice().sort().join("|");
}

export function getCachedDomainRecords(
  hostnames: string[],
): PublishedDomainRecord[] | null {
  const key = cacheKey(hostnames);
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order for a simple LRU-ish eviction.
  cache.delete(key);
  cache.set(key, entry);
  return entry.records;
}

export function setCachedDomainRecords(
  hostnames: string[],
  records: PublishedDomainRecord[],
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (records.some((record) => !isCacheableSite(record.site))) return;
  const key = cacheKey(hostnames);
  cache.set(key, { expiresAt: Date.now() + ttlMs, records });
  while (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function clearDomainLookupCache(): void {
  cache.clear();
  platformCache.clear();
}

/** Drop every cache key that mentions one of these hostnames. */
export function invalidateDomainLookupHostnames(hostnames: string[]): void {
  if (hostnames.length === 0) return;
  const wanted = new Set(hostnames.map((value) => value.toLowerCase()));
  for (const key of cache.keys()) {
    const parts = key.split("|");
    if (parts.some((part) => wanted.has(part))) {
      cache.delete(key);
    }
  }
}

export function getCachedPlatformSite(
  slug: string,
): PlatformSubdomainSite | null | undefined {
  const entry = platformCache.get(slug);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    platformCache.delete(slug);
    return undefined;
  }
  platformCache.delete(slug);
  platformCache.set(slug, entry);
  return entry.site;
}

export function setCachedPlatformSite(
  slug: string,
  site: PlatformSubdomainSite | null,
  ttlMs = DEFAULT_TTL_MS,
): void {
  if (site && !isCacheableSite(site)) return;
  platformCache.set(slug, { expiresAt: Date.now() + ttlMs, site });
  while (platformCache.size > MAX_ENTRIES) {
    const oldest = platformCache.keys().next().value;
    if (oldest === undefined) break;
    platformCache.delete(oldest);
  }
}

export function invalidatePlatformSiteSlug(slug: string): void {
  platformCache.delete(slug);
}
