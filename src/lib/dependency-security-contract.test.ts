import { describe, expect, it } from "bun:test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dir, "../..");
const packageJson = await Bun.file(path.join(repoRoot, "package.json")).json();
const lockfile = await Bun.file(path.join(repoRoot, "bun.lock")).text();

describe("dependency security migration", () => {
  it("uses supported upgrades without transitive manifest patches", () => {
    expect(packageJson.devDependencies["@lhci/cli"]).toBeUndefined();
    expect(packageJson.devDependencies["chrome-launcher"]).toBe("1.2.3");
    expect(packageJson.devDependencies.lighthouse).toBe("13.6.0");
    expect(packageJson.devDependencies["puppeteer-core"]).toBe("25.17.0");
    expect(packageJson.dependencies.workflow).toBe("5.5.0");
    expect(packageJson.dependencies["@workflow/world-postgres"]).toBe("5.2.0");
    // shadcn is a CLI; only its stylesheet is used, vendored as src/app/shadcn.css.
    expect(packageJson.dependencies.shadcn).toBeUndefined();
    expect(packageJson.overrides["deepmerge-ts"]).toBe("8.0.0");
    expect(packageJson.overrides["minimatch@^10"]).toBe("11.0.8");
    expect(packageJson.overrides["zod@<4.6.6"]).toBe("4.6.7");
    expect(packageJson.overrides.nanoid).toBeUndefined();
    expect(packageJson.overrides.undici).toBeUndefined();
    expect(packageJson.patchedDependencies).toBeUndefined();
  });

  it("locks only remediated versions while preserving intentional major splits", () => {
    for (const vulnerableResolution of [
      "@lhci/cli@",
      "deepmerge@",
      "deepmerge-ts@7.1.5",
      "extract-zip@",
      "minimatch@10.",
      "nanoid@5.1.6",
      "shadcn@",
      "tmp@0.0.33",
      "tmp@0.1.0",
      "undici@7.28.0",
      "uuid@8.3.2",
      "zod@3.",
      "zod@4.1.",
    ]) {
      expect(lockfile).not.toContain(vulnerableResolution);
    }

    expect(lockfile).toContain('"deepmerge-ts@8.0.0"');
    expect(lockfile).toContain(
      '"@workflow/world-local/undici": ["undici@7.30.2"',
    );
    expect(lockfile).toContain(
      '"@workflow/world-vercel/undici": ["undici@7.30.2"',
    );
    expect(lockfile).toContain('"nanoid": ["nanoid@3.3.20"');
    expect(lockfile).toContain('"undici": ["undici@8.12.4"');
    expect(lockfile).toContain('"zod": ["zod@4.6.7"');
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
      postcssNanoid: "3.3.20",
      workflowLocalUndici: "7.30.2",
      workflowVercelUndici: "7.30.2",
      rootUndici: "8.12.4",
      prismaSchema: path.join(repoRoot, "prisma/schema.prisma"),
      fastUri: "3.1.9",
      mysql2: "3.24.3",
      qs: "6.17.1",
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
  const postcssNanoid = resolveDependency("node_modules/postcss", "nanoid");
  const localUndici = resolveDependency("node_modules/@workflow/world-local", "undici");
  const vercelUndici = resolveDependency("node_modules/@workflow/world-vercel", "undici");
  const rootUndici = resolveDependency(".", "undici");
  const fastUri = resolveDependency(".", "fast-uri");
  const mysql2 = resolveDependency("node_modules/prisma", "mysql2");
  const queryString = resolveDependency(".", "qs");
  const require = createRequire(path.resolve("package.json"));
  const uri = require(fastUri.entry);
  if (uri.serialize(uri.parse("https://example.test/menu?q=1")) !== "https://example.test/menu?q=1") throw new Error("fast-uri API mismatch");
  const mysql = require(mysql2.entry);
  if (mysql.format("SELECT ?", [42]) !== "SELECT 42") throw new Error("mysql2 API mismatch");
  const qs = require(queryString.entry);
  if (qs.parse("filter[name]=menu").filter.name !== "menu") throw new Error("qs API mismatch");

  const deepmerge = await import(pathToFileURL(prismaDependency.entry).href);
  const merged = deepmerge.deepmerge({ nested: { left: true } }, { nested: { right: true } });
  if (!merged.nested.left || !merged.nested.right) throw new Error("deepmerge-ts API mismatch");

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
    postcssNanoid: postcssNanoid.version,
    workflowLocalUndici: localUndici.version,
    workflowVercelUndici: vercelUndici.version,
    rootUndici: rootUndici.version,
    prismaSchema: prisma.config.schema,
    fastUri: fastUri.version,
    mysql2: mysql2.version,
    qs: queryString.version,
  }) + "\n");
`;
