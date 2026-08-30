import { describe, expect, it } from "bun:test";
import {
  assertGithubDependencySnapshot,
  assertGithubDependencySnapshotShape,
  BUN_DEPENDENCY_SNAPSHOT_CORRELATOR,
  BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME,
  BUN_DEPENDENCY_SNAPSHOT_DETECTOR_URL,
  BUN_DEPENDENCY_SNAPSHOT_DETECTOR_VERSION,
  BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME,
  BUN_DEPENDENCY_SNAPSHOT_MIN_RESOLVED_PACKAGES,
  buildBunDependencySnapshot,
  GITHUB_LIVE_SBOM_DIRECT_ENTRY_CEILING,
  npmPackageUrl,
  snapshotSummary,
} from "@/lib/bun-dependency-snapshot";

const repoRoot = new URL("../..", import.meta.url);
const scanned = "2026-08-25T00:00:00.000Z";
const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ref = "refs/heads/main";

const fixturePackageJson = `{
  "name": "fixture",
  "dependencies": {
    "left-pad": "1.3.0"
  },
  "devDependencies": {
    "@types/node": "24.3.0",
    "typescript": "5.8.2"
  }
}`;

const fixtureLockfile = `{
  "lockfileVersion": 1,
  "workspaces": {
    "": {
      "name": "fixture",
      "dependencies": {
        "left-pad": "1.3.0",
      },
      "devDependencies": {
        "@types/node": "24.3.0",
        "typescript": "5.8.2",
      },
    },
  },
  "packages": {
    "@types/node": ["@types/node@24.3.0", "", { "dependencies": { "undici-types": "~7.16.0" } }, "sha512-test"],
    "left-pad": ["left-pad@1.3.0", "", { "dependencies": { "nanoid": "3.3.18" } }, "sha512-test"],
    "left-pad/nanoid": ["nanoid@5.1.16", "", {}, "sha512-test"],
    "nanoid": ["nanoid@3.3.18", "", {}, "sha512-test"],
    "typescript": ["typescript@5.8.2", "", {}, "sha512-test"],
    "undici-types": ["undici-types@7.16.0", "", {}, "sha512-test"],
  },
}`;

function fixtureSnapshot() {
  return buildBunDependencySnapshot({
    packageJsonSource: fixturePackageJson,
    lockfileSource: fixtureLockfile,
    sha,
    ref,
    scanned,
    job: { id: "run-1", correlator: BUN_DEPENDENCY_SNAPSHOT_CORRELATOR },
  });
}

describe("npm package URLs", () => {
  it("encodes scoped and unscoped names with exact versions", () => {
    expect(npmPackageUrl("left-pad", "1.3.0")).toBe("pkg:npm/left-pad@1.3.0");
    expect(npmPackageUrl("@types/node", "24.3.0")).toBe(
      "pkg:npm/%40types/node@24.3.0",
    );
  });
});

describe("bun.lock snapshot builder", () => {
  it("classifies direct, nested, and development packages from the lockfile", () => {
    const snapshot = fixtureSnapshot();
    assertGithubDependencySnapshotShape(snapshot);
    const resolved =
      snapshot.manifests[BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME].resolved;

    expect(resolved[npmPackageUrl("left-pad", "1.3.0")]).toEqual({
      package_url: "pkg:npm/left-pad@1.3.0",
      relationship: "direct",
      scope: "runtime",
      dependencies: ["pkg:npm/nanoid@5.1.16"],
    });
    expect(resolved[npmPackageUrl("nanoid", "5.1.16")]).toEqual({
      package_url: "pkg:npm/nanoid@5.1.16",
      relationship: "indirect",
      scope: "runtime",
    });
    expect(resolved[npmPackageUrl("nanoid", "3.3.18")]).toEqual({
      package_url: "pkg:npm/nanoid@3.3.18",
      relationship: "indirect",
      scope: "development",
    });
    expect(resolved[npmPackageUrl("typescript", "5.8.2")]).toEqual({
      package_url: "pkg:npm/typescript@5.8.2",
      relationship: "direct",
      scope: "development",
    });
    expect(resolved[npmPackageUrl("@types/node", "24.3.0")]).toEqual({
      package_url: "pkg:npm/%40types/node@24.3.0",
      relationship: "direct",
      scope: "development",
      dependencies: ["pkg:npm/undici-types@7.16.0"],
    });
    expect(snapshot.detector).toEqual({
      name: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME,
      version: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_VERSION,
      url: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_URL,
    });
    expect(snapshot.job.correlator).toBe(BUN_DEPENDENCY_SNAPSHOT_CORRELATOR);
  });

  it("is deterministic for the same lockfile and scan metadata", () => {
    expect(JSON.stringify(fixtureSnapshot())).toBe(
      JSON.stringify(fixtureSnapshot()),
    );
  });

  it("does not resolve floating versions or mutate the committed sources", () => {
    const packageJsonSource = fixturePackageJson;
    const lockfileSource = fixtureLockfile;
    buildBunDependencySnapshot({
      packageJsonSource,
      lockfileSource,
      sha,
      ref,
      scanned,
      job: { id: "run-1", correlator: BUN_DEPENDENCY_SNAPSHOT_CORRELATOR },
    });
    expect(packageJsonSource).toBe(fixturePackageJson);
    expect(lockfileSource).toBe(fixtureLockfile);
  });

  it("rejects lockfiles that are missing a declared package", () => {
    expect(() =>
      buildBunDependencySnapshot({
        packageJsonSource: fixturePackageJson,
        lockfileSource: fixtureLockfile.replace(
          '    "typescript": ["typescript@5.8.2", "", {}, "sha512-test"],\n',
          "",
        ),
        sha,
        ref,
        scanned,
        job: { id: "run-1", correlator: BUN_DEPENDENCY_SNAPSHOT_CORRELATOR },
      }),
    ).toThrow("bun.lock is missing typescript");
  });
});

describe("committed bun.lock graph", () => {
  it("submits a complete lockfile graph instead of the direct-only GitHub SBOM", async () => {
    const [packageJsonSource, lockfileSource] = await Promise.all([
      Bun.file(new URL("package.json", repoRoot)).text(),
      Bun.file(new URL("bun.lock", repoRoot)).text(),
    ]);
    const packageJson = JSON.parse(packageJsonSource) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const snapshot = buildBunDependencySnapshot({
      packageJsonSource,
      lockfileSource,
      sha,
      ref,
      scanned,
      job: {
        id: "committed-lockfile",
        correlator: BUN_DEPENDENCY_SNAPSHOT_CORRELATOR,
      },
    });
    assertGithubDependencySnapshot(snapshot);

    const resolved =
      snapshot.manifests[BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME].resolved;
    const summary = snapshotSummary(snapshot);
    const directNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];

    expect(summary.resolved).toBeGreaterThan(
      GITHUB_LIVE_SBOM_DIRECT_ENTRY_CEILING,
    );
    expect(summary.resolved).toBeGreaterThanOrEqual(
      BUN_DEPENDENCY_SNAPSHOT_MIN_RESOLVED_PACKAGES,
    );
    expect(summary.direct).toBe(directNames.length);
    expect(summary.indirect).toBeGreaterThan(summary.direct);
    expect(summary.runtime).toBeGreaterThan(0);
    expect(summary.development).toBeGreaterThan(0);

    expect(resolved[npmPackageUrl("next", "16.3.3")]?.relationship).toBe(
      "direct",
    );
    expect(resolved[npmPackageUrl("next", "16.3.3")]?.scope).toBe("runtime");
    expect(resolved[npmPackageUrl("typescript", "6.0.3")]?.relationship).toBe(
      "direct",
    );
    expect(resolved[npmPackageUrl("typescript", "6.0.3")]?.scope).toBe(
      "development",
    );
    expect(resolved[npmPackageUrl("@ai-sdk/gateway", "4.0.67")]).toEqual({
      package_url: "pkg:npm/%40ai-sdk/gateway@4.0.67",
      relationship: "indirect",
      scope: "runtime",
      dependencies: [
        "pkg:npm/%40ai-sdk/provider-utils@5.0.32",
        "pkg:npm/%40ai-sdk/provider@4.0.8",
        "pkg:npm/%40vercel/oidc@3.2.0",
      ],
    });
    expect(resolved[npmPackageUrl("axe-core", "4.13.0")]?.relationship).toBe(
      "indirect",
    );
    expect(resolved[npmPackageUrl("axe-core", "4.13.0")]?.scope).toBe(
      "development",
    );
    expect(resolved[npmPackageUrl("nanoid", "5.1.16")]?.relationship).toBe(
      "indirect",
    );
    expect(resolved[npmPackageUrl("nanoid", "3.3.18")]?.package_url).toBe(
      "pkg:npm/nanoid@3.3.18",
    );
    expect(packageJson.dependencies?.["@ai-sdk/gateway"]).toBeUndefined();
    expect(packageJson.devDependencies?.["axe-core"]).toBeUndefined();
    expect(lockfileSource).toContain('"@ai-sdk/gateway@4.0.67"');
    expect(lockfileSource).toContain('"axe-core@');
  });
});
