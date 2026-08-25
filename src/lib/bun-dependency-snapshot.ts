export const BUN_DEPENDENCY_SNAPSHOT_WORKFLOW_NAME =
  "Bun dependency snapshot";
export const BUN_DEPENDENCY_SNAPSHOT_VALIDATE_JOB = "validate";
export const BUN_DEPENDENCY_SNAPSHOT_SUBMIT_JOB = "submit";
export const BUN_DEPENDENCY_SNAPSHOT_CORRELATOR = `${BUN_DEPENDENCY_SNAPSHOT_WORKFLOW_NAME} ${BUN_DEPENDENCY_SNAPSHOT_SUBMIT_JOB}`;
export const BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME =
  "cornershopdev-bun-lockfile";
export const BUN_DEPENDENCY_SNAPSHOT_DETECTOR_VERSION = "1";
export const BUN_DEPENDENCY_SNAPSHOT_DETECTOR_URL =
  "https://github.com/cornershopdev/cornershop.dev";
export const BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME = "bun.lock";
export const BUN_DEPENDENCY_SNAPSHOT_VERSION = 0;
export const GITHUB_LIVE_SBOM_DIRECT_ENTRY_CEILING = 49;
export const BUN_DEPENDENCY_SNAPSHOT_MIN_RESOLVED_PACKAGES = 200;

const GITHUB_SNAPSHOT_SHA_PATTERN = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const NPM_PURL_PATTERN = /^pkg:npm\/(?:%40[^/@]+\/)?[^/@]+@.+$/;

export type DependencyRelationship = "direct" | "indirect";
export type DependencyScope = "runtime" | "development";

export type GithubSnapshotJob = {
  id: string;
  correlator: string;
  html_url?: string;
};

export type GithubSnapshotDetector = {
  name: string;
  version: string;
  url: string;
};

export type GithubResolvedDependency = {
  package_url: string;
  relationship: DependencyRelationship;
  scope: DependencyScope;
  dependencies?: string[];
};

export type GithubSnapshotManifest = {
  name: string;
  file: {
    source_location: string;
  };
  resolved: Record<string, GithubResolvedDependency>;
};

export type GithubDependencySnapshot = {
  version: number;
  sha: string;
  ref: string;
  job: GithubSnapshotJob;
  detector: GithubSnapshotDetector;
  scanned: string;
  manifests: Record<string, GithubSnapshotManifest>;
};

export type SnapshotJobContext = {
  id: string;
  correlator: string;
  htmlUrl?: string;
};

export type SnapshotBuildInput = {
  packageJsonSource: string;
  lockfileSource: string;
  sha: string;
  ref: string;
  job: SnapshotJobContext;
  scanned: string;
};

type StringMap = Record<string, string>;

type PackageManifest = {
  dependencies: StringMap;
  devDependencies: StringMap;
  optionalDependencies: StringMap;
};

type LockPackage = {
  name: string;
  version: string;
  purl: string;
  dependencies: StringMap;
};

type WalkScope = DependencyScope;

export function npmPackageUrl(name: string, version: string): string {
  if (!name || !version) {
    throw new Error("npm package URL requires a name and version.");
  }
  if (name.startsWith("@")) {
    const slash = name.indexOf("/");
    if (slash <= 1 || slash === name.length - 1) {
      throw new Error(`Invalid scoped package name: ${name}`);
    }
    const scope = name.slice(0, slash);
    const pkg = name.slice(slash + 1);
    return `pkg:npm/${encodeURIComponent(scope)}/${encodeURIComponent(pkg)}@${encodeURIComponent(version)}`;
  }
  return `pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

export function parseJsonDocument(source: string): unknown {
  return JSON.parse(stripJsonDocumentNoise(source));
}

export function buildBunDependencySnapshot(
  input: SnapshotBuildInput,
): GithubDependencySnapshot {
  if (!GITHUB_SNAPSHOT_SHA_PATTERN.test(input.sha)) {
    throw new Error("Snapshot SHA must be a 40- or 64-character hex commit.");
  }
  if (!input.ref.startsWith("refs/")) {
    throw new Error("Snapshot ref must be a fully qualified git ref.");
  }
  if (!input.job.id.trim() || !input.job.correlator.trim()) {
    throw new Error("Snapshot job id and correlator are required.");
  }
  if (Number.isNaN(Date.parse(input.scanned))) {
    throw new Error("Snapshot scanned time must be an ISO-8601 timestamp.");
  }

  const manifest = parsePackageManifest(input.packageJsonSource);
  const lockfile = parseBunLockfile(input.lockfileSource);
  assertManifestMatchesLockfile(manifest, lockfile.root);

  const packages = parseLockPackages(lockfile.packages);
  const resolved = resolveGraph(manifest, packages);

  const job: GithubSnapshotJob = {
    id: input.job.id,
    correlator: input.job.correlator,
  };
  if (input.job.htmlUrl) job.html_url = input.job.htmlUrl;

  return {
    version: BUN_DEPENDENCY_SNAPSHOT_VERSION,
    sha: input.sha,
    ref: input.ref,
    job,
    detector: {
      name: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME,
      version: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_VERSION,
      url: BUN_DEPENDENCY_SNAPSHOT_DETECTOR_URL,
    },
    scanned: input.scanned,
    manifests: {
      [BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME]: {
        name: BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME,
        file: { source_location: BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME },
        resolved,
      },
    },
  };
}

export function assertGithubDependencySnapshotShape(
  snapshot: GithubDependencySnapshot,
): void {
  if (snapshot.version !== BUN_DEPENDENCY_SNAPSHOT_VERSION) {
    throw new Error("Snapshot version must be 0.");
  }
  if (!GITHUB_SNAPSHOT_SHA_PATTERN.test(snapshot.sha)) {
    throw new Error("Snapshot SHA must be a 40- or 64-character hex commit.");
  }
  if (!snapshot.ref.startsWith("refs/")) {
    throw new Error("Snapshot ref must be a fully qualified git ref.");
  }
  if (
    snapshot.detector.name !== BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME ||
    snapshot.detector.version !== BUN_DEPENDENCY_SNAPSHOT_DETECTOR_VERSION ||
    snapshot.detector.url !== BUN_DEPENDENCY_SNAPSHOT_DETECTOR_URL
  ) {
    throw new Error("Snapshot detector identity is not stable.");
  }
  if (snapshot.job.correlator !== BUN_DEPENDENCY_SNAPSHOT_CORRELATOR) {
    throw new Error("Snapshot correlator is not the stable submit key.");
  }
  const manifest = snapshot.manifests[BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME];
  if (!manifest) {
    throw new Error("Snapshot is missing the bun.lock manifest.");
  }
  const resolvedEntries = Object.entries(manifest.resolved);
  const seenPurls = new Set<string>();
  for (const [key, dependency] of resolvedEntries) {
    if (key !== dependency.package_url) {
      throw new Error(`Resolved key ${key} does not match package_url.`);
    }
    if (seenPurls.has(dependency.package_url)) {
      throw new Error(`Duplicate package URL ${dependency.package_url}.`);
    }
    seenPurls.add(dependency.package_url);
    if (!NPM_PURL_PATTERN.test(dependency.package_url)) {
      throw new Error(`Invalid npm package URL ${dependency.package_url}.`);
    }
    if (
      dependency.relationship !== "direct" &&
      dependency.relationship !== "indirect"
    ) {
      throw new Error(`Invalid relationship for ${dependency.package_url}.`);
    }
    if (dependency.scope !== "runtime" && dependency.scope !== "development") {
      throw new Error(`Invalid scope for ${dependency.package_url}.`);
    }
    for (const child of dependency.dependencies ?? []) {
      if (!NPM_PURL_PATTERN.test(child)) {
        throw new Error(`Invalid child package URL ${child}.`);
      }
    }
  }
}

export function assertGithubDependencySnapshot(
  snapshot: GithubDependencySnapshot,
): void {
  assertGithubDependencySnapshotShape(snapshot);
  const resolvedCount = Object.keys(
    snapshot.manifests[BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME]?.resolved ?? {},
  ).length;
  if (resolvedCount < BUN_DEPENDENCY_SNAPSHOT_MIN_RESOLVED_PACKAGES) {
    throw new Error(
      `Snapshot resolved ${resolvedCount} packages; expected more than the GitHub direct-only graph.`,
    );
  }
}

export function snapshotSummary(snapshot: GithubDependencySnapshot): {
  manifest: string;
  resolved: number;
  direct: number;
  indirect: number;
  runtime: number;
  development: number;
} {
  const resolved = Object.values(
    snapshot.manifests[BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME]?.resolved ?? {},
  );
  return {
    manifest: BUN_DEPENDENCY_SNAPSHOT_MANIFEST_NAME,
    resolved: resolved.length,
    direct: resolved.filter((entry) => entry.relationship === "direct").length,
    indirect: resolved.filter((entry) => entry.relationship === "indirect")
      .length,
    runtime: resolved.filter((entry) => entry.scope === "runtime").length,
    development: resolved.filter((entry) => entry.scope === "development")
      .length,
  };
}

function parsePackageManifest(source: string): PackageManifest {
  const parsed = JSON.parse(source) as unknown;
  if (!isRecord(parsed)) throw new Error("package.json must be an object.");
  return {
    dependencies: optionalStringMap(parsed.dependencies, "dependencies"),
    devDependencies: optionalStringMap(
      parsed.devDependencies,
      "devDependencies",
    ),
    optionalDependencies: optionalStringMap(
      parsed.optionalDependencies,
      "optionalDependencies",
    ),
  };
}

type ParsedLockfile = {
  lockfileVersion: number;
  root: PackageManifest;
  packages: Record<string, unknown>;
};

function parseBunLockfile(source: string): ParsedLockfile {
  const parsed = parseJsonDocument(source);
  if (!isRecord(parsed)) throw new Error("bun.lock must be an object.");
  if (parsed.lockfileVersion !== 1) {
    throw new Error("bun.lock lockfileVersion must be 1.");
  }
  if (!isRecord(parsed.workspaces) || !isRecord(parsed.workspaces[""])) {
    throw new Error("bun.lock is missing the root workspace.");
  }
  if (!isRecord(parsed.packages)) {
    throw new Error("bun.lock is missing the packages map.");
  }
  const rootWorkspace = parsed.workspaces[""];
  return {
    lockfileVersion: 1,
    root: {
      dependencies: optionalStringMap(
        rootWorkspace.dependencies,
        "workspaces[\"\"].dependencies",
      ),
      devDependencies: optionalStringMap(
        rootWorkspace.devDependencies,
        "workspaces[\"\"].devDependencies",
      ),
      optionalDependencies: optionalStringMap(
        rootWorkspace.optionalDependencies,
        "workspaces[\"\"].optionalDependencies",
      ),
    },
    packages: parsed.packages,
  };
}

function assertManifestMatchesLockfile(
  manifest: PackageManifest,
  lockRoot: PackageManifest,
): void {
  for (const field of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ] as const) {
    const declared = Object.keys(manifest[field]).sort();
    const locked = Object.keys(lockRoot[field]).sort();
    if (declared.join("\0") !== locked.join("\0")) {
      throw new Error(
        `package.json ${field} do not match bun.lock workspace ${field}.`,
      );
    }
  }
}

function parseLockPackages(
  packages: Record<string, unknown>,
): Map<string, LockPackage> {
  const parsed = new Map<string, LockPackage>();
  for (const [key, value] of Object.entries(packages)) {
    if (!Array.isArray(value) || typeof value[0] !== "string") {
      throw new Error(`bun.lock package ${key} is not a resolved tuple.`);
    }
    const identity = parseNpmIdentity(value[0]);
    const metadata = isRecord(value[2]) ? value[2] : {};
    parsed.set(key, {
      name: identity.name,
      version: identity.version,
      purl: npmPackageUrl(identity.name, identity.version),
      dependencies: {
        ...optionalStringMap(metadata.dependencies, `${key}.dependencies`),
        ...optionalStringMap(
          metadata.optionalDependencies,
          `${key}.optionalDependencies`,
        ),
      },
    });
  }
  return parsed;
}

function parseNpmIdentity(identity: string): { name: string; version: string } {
  if (
    identity.includes(":") ||
    identity.includes(" ") ||
    identity.includes("\\")
  ) {
    throw new Error(`Unsupported bun.lock package identity: ${identity}`);
  }
  if (identity.startsWith("@")) {
    const separator = identity.indexOf("@", 1);
    if (separator <= 1 || separator === identity.length - 1) {
      throw new Error(`Invalid scoped package identity: ${identity}`);
    }
    const name = identity.slice(0, separator);
    if (!name.includes("/")) {
      throw new Error(`Invalid scoped package identity: ${identity}`);
    }
    return { name, version: identity.slice(separator + 1) };
  }
  const separator = identity.indexOf("@");
  if (separator <= 0 || separator === identity.length - 1) {
    throw new Error(`Invalid package identity: ${identity}`);
  }
  return {
    name: identity.slice(0, separator),
    version: identity.slice(separator + 1),
  };
}

function resolveGraph(
  manifest: PackageManifest,
  packages: Map<string, LockPackage>,
): Record<string, GithubResolvedDependency> {
  const nodes = new Map<
    string,
    {
      relationship: DependencyRelationship;
      scope: DependencyScope;
      children: Set<string>;
    }
  >();

  const visit = (
    parentName: string | null,
    depName: string,
    relationship: DependencyRelationship,
    scope: WalkScope,
  ) => {
    const resolved = lookupPackage(packages, parentName, depName);
    const existing = nodes.get(resolved.purl);
    if (existing) {
      if (relationship === "direct") existing.relationship = "direct";
      if (scope === "runtime") existing.scope = "runtime";
      return;
    }
    const children = new Set<string>();
    nodes.set(resolved.purl, { relationship, scope, children });
    for (const childName of Object.keys(resolved.dependencies).sort()) {
      const child = lookupPackage(packages, resolved.name, childName);
      children.add(child.purl);
      visit(resolved.name, childName, "indirect", scope);
    }
  };

  for (const name of [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.optionalDependencies),
  ].sort()) {
    visit(null, name, "direct", "runtime");
  }
  for (const name of Object.keys(manifest.devDependencies).sort()) {
    visit(null, name, "direct", "development");
  }

  for (const pkg of packages.values()) {
    if (nodes.has(pkg.purl)) continue;
    nodes.set(pkg.purl, {
      relationship: "indirect",
      scope: "development",
      children: new Set(
        Object.keys(pkg.dependencies)
          .sort()
          .map((childName) => lookupPackage(packages, pkg.name, childName).purl),
      ),
    });
  }

  const resolved: Record<string, GithubResolvedDependency> = {};
  for (const purl of [...nodes.keys()].sort()) {
    const node = nodes.get(purl);
    if (!node) continue;
    const entry: GithubResolvedDependency = {
      package_url: purl,
      relationship: node.relationship,
      scope: node.scope,
    };
    if (node.children.size > 0) {
      entry.dependencies = [...node.children].sort();
    }
    resolved[purl] = entry;
  }
  return resolved;
}

function lookupPackage(
  packages: Map<string, LockPackage>,
  parentName: string | null,
  depName: string,
): LockPackage {
  const nested = parentName ? packages.get(`${parentName}/${depName}`) : undefined;
  const resolved = nested ?? packages.get(depName);
  if (!resolved) {
    const parent = parentName ?? "workspace";
    throw new Error(`bun.lock is missing ${depName} required by ${parent}.`);
  }
  return resolved;
}

function optionalStringMap(value: unknown, label: string): StringMap {
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const result: StringMap = {};
  for (const [key, mapped] of Object.entries(value)) {
    if (typeof mapped !== "string") {
      throw new Error(`${label}.${key} must be a string.`);
    }
    result[key] = mapped;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripJsonDocumentNoise(source: string): string {
  let result = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === "\"") {
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (source[cursor] === "\"") {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      result += source.slice(index, cursor);
      index = cursor;
      continue;
    }
    if (char === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index += 2;
      while (
        index + 1 < source.length &&
        !(source[index] === "*" && source[index + 1] === "/")
      ) {
        index += 1;
      }
      index += 2;
      continue;
    }
    result += char;
    index += 1;
  }

  let stripped = result;
  for (;;) {
    const next = stripped.replace(/,(\s*[}\]])/g, "$1");
    if (next === stripped) return stripped;
    stripped = next;
  }
}
