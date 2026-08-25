import { resolve } from "node:path";
import {
  assertGithubDependencySnapshot,
  BUN_DEPENDENCY_SNAPSHOT_CORRELATOR,
  buildBunDependencySnapshot,
  snapshotSummary,
} from "@/lib/bun-dependency-snapshot";

const outputPath = requiredOption("--output");
const repoRoot = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd());
const sha = requiredEnv("GITHUB_SHA");
const ref = requiredEnv("GITHUB_REF");
const runId = process.env.GITHUB_RUN_ID ?? "local-dry-run";
const serverUrl = process.env.GITHUB_SERVER_URL;
const repository = process.env.GITHUB_REPOSITORY;

const [packageJsonSource, lockfileSource] = await Promise.all([
  Bun.file(resolve(repoRoot, "package.json")).text(),
  Bun.file(resolve(repoRoot, "bun.lock")).text(),
]);

const snapshot = buildBunDependencySnapshot({
  packageJsonSource,
  lockfileSource,
  sha,
  ref,
  scanned: new Date().toISOString(),
  job: {
    id: runId,
    correlator: BUN_DEPENDENCY_SNAPSHOT_CORRELATOR,
    htmlUrl:
      serverUrl && repository
        ? `${serverUrl}/${repository}/actions/runs/${runId}`
        : undefined,
  },
});

assertGithubDependencySnapshot(snapshot);
await Bun.write(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
process.stderr.write(`${JSON.stringify(snapshotSummary(snapshot))}\n`);

function requiredOption(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    process.stderr.write(`Missing required ${flag} path.\n`);
    process.exit(1);
  }
  return resolve(value);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    process.stderr.write(`Missing required environment variable ${name}.\n`);
    process.exit(1);
  }
  return value;
}
