import { describe, expect, it } from "bun:test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../..");
const packageJson = await Bun.file(path.join(repoRoot, "package.json")).json();
const lockfile = await Bun.file(path.join(repoRoot, "bun.lock")).text();

const patches = [
  {
    package: "@workflow/core@4.8.4",
    file: "patches/@workflow%2Fcore@4.8.4.patch",
    dependency: "nanoid",
    from: "5.1.6",
    to: "5.1.16",
    sha256: "e6872431c9b82f5ce2115e6a17e23740d39373a601e0ba061cc40da7cc6d79f5",
  },
  {
    package: "@workflow/world-local@4.3.0",
    file: "patches/@workflow%2Fworld-local@4.3.0.patch",
    dependency: "undici",
    from: "7.28.0",
    to: "7.29.0",
    sha256: "18e492ba1128c164e2be37b16bb100bd9c56b3b97aa9181cf812dda0a3b8d1ef",
  },
  {
    package: "@workflow/world-vercel@4.7.0",
    file: "patches/@workflow%2Fworld-vercel@4.7.0.patch",
    dependency: "undici",
    from: "7.28.0",
    to: "7.29.0",
    sha256: "6aabb73040cd6d69a52a96883e10223f28bc6cd65a2518ffc702046f120a0601",
  },
] as const;

describe("dependency security migration", () => {
  it("uses supported upgrades and narrowly scoped Workflow patches", () => {
    expect(packageJson.devDependencies["@lhci/cli"]).toBeUndefined();
    expect(packageJson.devDependencies["chrome-launcher"]).toBe("1.2.1");
    expect(packageJson.devDependencies.lighthouse).toBe("13.4.1");
    expect(packageJson.devDependencies["puppeteer-core"]).toBe("25.9.0");
    expect(packageJson.overrides["deepmerge-ts"]).toBe("8.0.0");
    expect(packageJson.overrides.nanoid).toBeUndefined();
    expect(packageJson.overrides.undici).toBeUndefined();
    expect(packageJson.patchedDependencies).toEqual(
      Object.fromEntries(patches.map((patch) => [patch.package, patch.file])),
    );
  });

  it("keeps every transitive patch manifest-only and checksum-pinned", async () => {
    for (const patch of patches) {
      const source = await Bun.file(path.join(repoRoot, patch.file)).text();
      const changedLines = source.split("\n").filter(
        (line) =>
          (line.startsWith("+") && !line.startsWith("+++")) ||
          (line.startsWith("-") && !line.startsWith("---")),
      );

      expect(source).toContain("diff --git a/package.json b/package.json");
      expect(source.match(/^diff --git /gm)).toHaveLength(1);
      expect(changedLines).toEqual([
        `-    "${patch.dependency}": "${patch.from}",`,
        `+    "${patch.dependency}": "${patch.to}",`,
      ]);
      expect(
        new Bun.CryptoHasher("sha256").update(source).digest("hex"),
      ).toBe(patch.sha256);
    }
  });

  it("locks only remediated versions while preserving intentional major splits", () => {
    for (const vulnerableResolution of [
      "@lhci/cli@",
      "deepmerge-ts@7.1.5",
      "extract-zip@",
      "nanoid@5.1.6",
      "tmp@0.0.33",
      "tmp@0.1.0",
      "undici@7.28.0",
      "uuid@8.3.2",
    ]) {
      expect(lockfile).not.toContain(vulnerableResolution);
    }

    expect(lockfile).toContain('"deepmerge-ts@8.0.0"');
    expect(lockfile).toContain(
      '"@workflow/core/nanoid": ["nanoid@5.1.16"',
    );
    expect(lockfile).toContain(
      '"@workflow/world-local/undici": ["undici@7.29.0"',
    );
    expect(lockfile).toContain(
      '"@workflow/world-vercel/undici": ["undici@7.29.0"',
    );
    expect(lockfile).toContain('"nanoid": ["nanoid@3.3.18"');
    expect(lockfile).toContain('"undici": ["undici@8.10.0"');
  });

  it("loads Prisma and exercises the exact Workflow dependency APIs", () => {
    const probe = Bun.spawnSync(
      ["node", "--input-type=module", "--eval", runtimeProbe],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://contract:contract@dependency-contract.invalid:5432/cornershopdev",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new TextDecoder().decode(probe.stdout);
    const stderr = new TextDecoder().decode(probe.stderr);

    expect(probe.exitCode, `${stdout}\n${stderr}`).toBe(0);
    const resultLine = stdout
      .split("\n")
      .find((line) => line.startsWith("DEPENDENCY_PROBE="));
    expect(resultLine, `${stdout}\n${stderr}`).toBeDefined();
    const result = JSON.parse(resultLine!.slice("DEPENDENCY_PROBE=".length));

    expect(result).toEqual({
      deepmerge: "8.0.0",
      workflowNanoid: "5.1.16",
      postcssNanoid: "3.3.18",
      workflowLocalUndici: "7.29.0",
      workflowVercelUndici: "7.29.0",
      rootUndici: "8.10.0",
      prismaSchema: path.join(repoRoot, "prisma/schema.prisma"),
      nanoidLength: 21,
    });
  });
});

const runtimeProbe = String.raw`
  import { readFileSync } from "node:fs";
  import { createRequire } from "node:module";
  import path from "node:path";
  import { pathToFileURL } from "node:url";

  function resolveDependency(parent, dependency) {
    const require = createRequire(path.resolve(parent, "package.json"));
    const entry = require.resolve(dependency);
    let directory = path.dirname(entry);
    while (directory !== path.dirname(directory)) {
      const packagePath = path.join(directory, "package.json");
      try {
        const manifest = JSON.parse(readFileSync(packagePath, "utf8"));
        if (manifest.name === dependency) {
          return { entry, version: manifest.version };
        }
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      directory = path.dirname(directory);
    }
    throw new Error("Could not locate " + dependency + " from " + parent);
  }

  const prismaDependency = resolveDependency("node_modules/@prisma/config", "deepmerge-ts");
  const coreNanoid = resolveDependency("node_modules/@workflow/core", "nanoid");
  const postcssNanoid = resolveDependency("node_modules/postcss", "nanoid");
  const localUndici = resolveDependency("node_modules/@workflow/world-local", "undici");
  const vercelUndici = resolveDependency("node_modules/@workflow/world-vercel", "undici");
  const rootUndici = resolveDependency(".", "undici");

  const deepmerge = await import(pathToFileURL(prismaDependency.entry).href);
  const merged = deepmerge.deepmerge({ nested: { left: true } }, { nested: { right: true } });
  if (!merged.nested.left || !merged.nested.right) throw new Error("deepmerge-ts API mismatch");

  const nanoid = await import(pathToFileURL(coreNanoid.entry).href);
  const generateNanoid = nanoid.customRandom(
    nanoid.urlAlphabet,
    21,
    (size) => new Uint8Array(size).fill(1),
  );
  const nanoidValue = generateNanoid();

  for (const dependency of [localUndici, vercelUndici]) {
    const undici = await import(pathToFileURL(dependency.entry).href);
    if (typeof undici.fetch !== "function") throw new Error("undici fetch API mismatch");
    const agent = new undici.Agent({ connections: 1 });
    const retryAgent = new undici.RetryAgent(agent);
    if (typeof retryAgent.dispatch !== "function") throw new Error("undici RetryAgent API mismatch");
    await agent.close();
  }

  const { loadConfigFromFile } = await import("@prisma/config");
  const prisma = await loadConfigFromFile({
    configFile: path.resolve("prisma.config.ts"),
    configRoot: process.cwd(),
  });
  if (prisma.error) throw prisma.error.error;

  process.stdout.write("DEPENDENCY_PROBE=" + JSON.stringify({
    deepmerge: prismaDependency.version,
    workflowNanoid: coreNanoid.version,
    postcssNanoid: postcssNanoid.version,
    workflowLocalUndici: localUndici.version,
    workflowVercelUndici: vercelUndici.version,
    rootUndici: rootUndici.version,
    prismaSchema: prisma.config.schema,
    nanoidLength: nanoidValue.length,
  }) + "\n");
`;
