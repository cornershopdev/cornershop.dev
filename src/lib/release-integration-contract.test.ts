import { describe, expect, it } from "bun:test";

/**
 * Release-truth integration contract. Pins the cross-PR invariants that the
 * deferred final-main integration gate for #110 requires to hold together on
 * main: #107 action pins, #115 photo CI and deploy propagation, #116 first
 * customer gates, and this branch's release-only deploy gate.
 */

const repoRoot = new URL("../..", import.meta.url);

async function readRepoFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, repoRoot)).text();
}

describe("release integration contract", () => {
  it("pins checkout and upload-artifact v7 in both workflows", async () => {
    const ci = await readRepoFile(".github/workflows/ci.yml");
    const deploy = await readRepoFile(
      ".github/workflows/deploy-production.yml",
    );
    expect(ci).toContain("actions/checkout@v7");
    expect(ci).toContain("actions/upload-artifact@v7");
    expect(deploy).toContain("actions/checkout@v7");
  });

  it("keeps the photo library Postgres suite in CI", async () => {
    const ci = await readRepoFile(".github/workflows/ci.yml");
    expect(ci).toContain("PHOTO_LIBRARY_POSTGRES_TEST");
    expect(ci).toContain("src/lib/photo-library.postgres.test.ts");
  });

  it("propagates every documented photo model, cost, and policy value to production", async () => {
    const deployScript = await readRepoFile("deploy/aws/deploy.sh");
    for (const variable of [
      "OPENROUTER_IMAGE_MODEL",
      "PHOTO_DISCOVERY_MAX_IMAGES",
      "PHOTO_ENHANCEMENT_BATCH_MAX_IMAGES",
      "PHOTO_ENHANCEMENT_CONCURRENCY",
      "PHOTO_ENHANCEMENT_ESTIMATED_COST_MICROS",
      "PHOTO_ENHANCEMENT_MODEL",
      "PHOTO_ENHANCEMENT_PER_IMAGE_CEILING_MICROS",
      "PHOTO_ENHANCEMENT_PER_SITE_CEILING_MICROS",
    ]) {
      expect(deployScript).toContain(variable);
    }
  });

  it("keeps production Redis on the required external managed service", async () => {
    const deployScript = await readRepoFile("deploy/aws/deploy.sh");
    expect(deployScript).toMatch(/required_parameters=\([\s\S]*?REDIS_URL/);
    expect(deployScript).not.toContain("cornershopdev-redis-data");
    expect(deployScript).not.toContain("redis:7.4-alpine");
  });

  it("keeps the host article-gate awk condition portable", async () => {
    const deployScript = await readRepoFile("deploy/aws/deploy.sh");
    expect(deployScript).not.toMatch(/if \(\s*\n/);
  });

  it("ships the article rollout operator used by production deploys", async () => {
    const dockerfile = await readRepoFile("Dockerfile");
    expect(dockerfile).toContain("bun build scripts/article-rollout.ts");
    expect(dockerfile).toContain(
      "--outfile=.operator-scripts/article-rollout.ts",
    );
  });

  it("keeps the browser journey as a production deploy dependency", async () => {
    const ci = await readRepoFile(".github/workflows/ci.yml");
    expect(ci).toMatch(
      /needs:\s*\[verify,\s*first-customer-browser-e2e,\s*container-runtime\]/,
    );
  });

  it("keeps production deployment stable-release-only", async () => {
    const ci = await readRepoFile(".github/workflows/ci.yml");
    expect(ci).toContain(
      "if: github.event_name == 'release' && github.event.release.prerelease == false",
    );
    expect(ci).not.toContain("'workflow_dispatch' || (github.event_name == 'release'");
  });

  it("keeps the SHA-bound release evidence states in deploy order", async () => {
    const deployScript = await readRepoFile("deploy/aws/deploy.sh");
    const states = [
      "configuration-loaded",
      "caddy-configured",
      "migrations-applied",
      "factory-analytics-ready",
      "outreach-configured",
      "wildcard-dns-ready",
      "platform-tls-ready",
      "production-deployed",
    ].map((state) => `release-state ${state} sha=`);
    let cursor = -1;
    for (const state of states) {
      const at = deployScript.indexOf(state, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
  });
});
