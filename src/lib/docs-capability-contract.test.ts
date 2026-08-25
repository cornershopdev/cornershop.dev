import { describe, expect, it } from "bun:test";
import {
  isVerticalPublicationEnabled,
  isVerticalPubliclyLaunched,
  listVerticalIds,
  resolveOwnerOperations,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

const repoRoot = new URL("../..", import.meta.url);

const CAPABILITY_HEADERS = [
  "Vertical",
  "Factory visibility",
  "Standalone launch",
  "Claim mode",
  "Owner mutation",
  "Platform publication",
  "Custom domains",
  "Monitoring",
  "Leads",
  "Articles",
] as const;

const STACK_MAJOR_PATTERNS = [
  { packageName: "next", pattern: /Next\.js (\d+)/ },
  { packageName: "react", pattern: /React (\d+)/ },
  { packageName: "prisma", pattern: /Prisma (\d+)/ },
  { packageName: "ai", pattern: /Vercel AI SDK (\d+)/ },
  { packageName: "tailwindcss", pattern: /Tailwind CSS v(\d+)/ },
] as const;

const DOC_FILES = [
  "README.md",
  "docs/verticals/food-retail.md",
  "docs/verticals/local-service.md",
] as const;

const GUIDE_VERTICAL: Record<
  "docs/verticals/food-retail.md" | "docs/verticals/local-service.md",
  VerticalId
> = {
  "docs/verticals/food-retail.md": "FOOD_RETAIL",
  "docs/verticals/local-service.md": "LOCAL_SERVICE",
};

type PackageJson = {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
};

type MarkdownTable = {
  headers: string[];
  rows: string[][];
};

const [readme, foodRetailGuide, localServiceGuide, packageJson] =
  await Promise.all([
    readRepoFile("README.md"),
    readRepoFile("docs/verticals/food-retail.md"),
    readRepoFile("docs/verticals/local-service.md"),
    readRepoJson("package.json"),
  ]);

const docsByPath = {
  "README.md": readme,
  "docs/verticals/food-retail.md": foodRetailGuide,
  "docs/verticals/local-service.md": localServiceGuide,
} as const;

describe("documented vertical capabilities", () => {
  it("keeps a README row for every registered vertical equal to the registry", () => {
    const documented = capabilityRows(readme);
    const expected = Object.fromEntries(
      listVerticalIds().map((id) => [verticalLabel(id), expectedCapabilityRow(id)]),
    );

    expect(Object.keys(documented).sort()).toEqual(Object.keys(expected).sort());
    expect(documented).toEqual(expected);
  });

  it("keeps Food Retail and Local Service guides on the same capability row", () => {
    for (const relativePath of Object.keys(GUIDE_VERTICAL) as Array<
      keyof typeof GUIDE_VERTICAL
    >) {
      const id = GUIDE_VERTICAL[relativePath];
      expect(capabilityRows(docsByPath[relativePath])).toEqual({
        [verticalLabel(id)]: expectedCapabilityRow(id),
      });
    }
  });
});

describe("documented stack majors", () => {
  it("matches package.json majors for every named stack package", () => {
    for (const { packageName, pattern } of STACK_MAJOR_PATTERNS) {
      const match = readme.match(pattern);
      expect(match?.[1]).toBeDefined();
      expect(Number(match?.[1])).toBe(packageMajor(packageName));
    }

    expect(packageMajor("prisma")).toBe(packageMajor("@prisma/client"));
    expect(readme).not.toContain("Vercel AI SDK 6");
  });
});

describe("documented links and commands", () => {
  it("resolves internal documentation links and bun commands without network", async () => {
    for (const relativePath of DOC_FILES) {
      const source = docsByPath[relativePath];
      const fileUrl = new URL(relativePath, repoRoot);

      for (const target of markdownLinkTargets(source)) {
        if (isExternalOrFragment(target)) continue;
        const resolved = new URL(stripFragment(target), fileUrl);
        expect(resolved.protocol).toBe("file:");
        expect(await Bun.file(resolved).exists()).toBe(true);
      }

      for (const script of bunRunScripts(source)) {
        expect(packageJson.scripts?.[script]).toBeDefined();
      }

      for (const binary of bunxBinaries(source)) {
        expect(packageSpec(bunxPackageName(binary))).toBeDefined();
      }
    }
  });
});

async function readRepoFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, repoRoot)).text();
}

async function readRepoJson(relativePath: string): Promise<PackageJson> {
  return Bun.file(new URL(relativePath, repoRoot)).json() as Promise<PackageJson>;
}

function verticalLabel(id: VerticalId): string {
  return id
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function expectedCapabilityRow(id: VerticalId): Record<string, string> {
  const config = resolveVerticalConfig(id);
  const operations = resolveOwnerOperations(id);
  return {
    Vertical: verticalLabel(id),
    "Factory visibility": config.marketing.publiclyAccessible
      ? "public"
      : "private",
    "Standalone launch": isVerticalPubliclyLaunched(id)
      ? "launched"
      : "unlaunched",
    "Claim mode": config.claimMode,
    "Owner mutation": operations.publicationMutation,
    "Platform publication": isVerticalPublicationEnabled(id)
      ? "enabled"
      : "disabled",
    "Custom domains": operations.customDomain,
    Monitoring: operations.sourceMonitoring,
    Leads: operations.bookingInbox,
    Articles: operations.articles,
  };
}

function capabilityRows(source: string): Record<string, Record<string, string>> {
  const table = parseMarkdownTables(source).find((candidate) =>
    headersMatch(candidate.headers, CAPABILITY_HEADERS),
  );
  expect(table).toBeDefined();
  if (!table) return {};

  const rows: Record<string, Record<string, string>> = {};
  for (const cells of table.rows) {
    expect(cells).toHaveLength(CAPABILITY_HEADERS.length);
    const row = Object.fromEntries(
      CAPABILITY_HEADERS.map((header, index) => [header, cells[index] ?? ""]),
    );
    const label = row.Vertical;
    expect(label).toBeTruthy();
    expect(rows[label]).toBeUndefined();
    rows[label] = row;
  }
  return rows;
}

function parseMarkdownTables(source: string): MarkdownTable[] {
  const tables: MarkdownTable[] = [];
  const lines = source.split("\n");
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = splitRow(lines[index] ?? "");
    const divider = splitRow(lines[index + 1] ?? "");
    if (!headers || !divider || !isDividerRow(divider)) continue;
    if (headers.length !== divider.length) continue;

    const rows: string[][] = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const cells = splitRow(lines[cursor] ?? "");
      if (!cells || cells.length !== headers.length) break;
      if (!isDividerRow(cells)) rows.push(cells);
      cursor += 1;
    }
    tables.push({ headers, rows });
  }
  return tables;
}

function splitRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes("|")) return null;
  return trimmed
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isDividerRow(cells: string[]): boolean {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function headersMatch(
  headers: string[],
  expected: readonly string[],
): boolean {
  return (
    headers.length === expected.length &&
    expected.every((header, index) => headers[index] === header)
  );
}

function packageSpec(name: string): string | undefined {
  return packageJson.dependencies?.[name] ?? packageJson.devDependencies?.[name];
}

function packageMajor(name: string): number {
  const spec = packageSpec(name);
  const match = spec?.match(/\d+/);
  if (!match) {
    throw new Error(`Missing version for ${name}`);
  }
  return Number(match[0]);
}

function markdownLinkTargets(source: string): string[] {
  return [...source.matchAll(/\[[^\]]*]\(([^)]+)\)/g)].map((match) => {
    const raw = match[1]?.trim() ?? "";
    const space = raw.search(/\s/);
    return space === -1 ? raw : raw.slice(0, space);
  });
}

function isExternalOrFragment(target: string): boolean {
  return (
    target.startsWith("#") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("mailto:")
  );
}

function stripFragment(target: string): string {
  const hash = target.indexOf("#");
  return hash === -1 ? target : target.slice(0, hash);
}

function bunRunScripts(source: string): string[] {
  return [...source.matchAll(/\bbun run ([a-zA-Z0-9:_-]+)/g)].map(
    (match) => match[1] ?? "",
  );
}

function bunxBinaries(source: string): string[] {
  return [...source.matchAll(/\bbunx(?: --bun)? ([a-zA-Z0-9@/_-]+)/g)].map(
    (match) => match[1] ?? "",
  );
}

function bunxPackageName(binary: string): string {
  if (binary === "tsc") return "typescript";
  if (binary === "next") return "next";
  return binary;
}
