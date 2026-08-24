import { describe, expect, it } from "bun:test";

const repoRoot = new URL("../../..", import.meta.url);
const [deployScript, entrypoint, migration, generateRoute, articleRoute] =
  await Promise.all(
    [
      "deploy/aws/deploy.sh",
      "deploy/aws/container-entrypoint.sh",
      "prisma/migrations/20260823110000_article_batch_admission_outcomes/migration.sql",
      "src/app/api/sites/[slug]/articles/generate/route.ts",
      "src/app/api/sites/[slug]/articles/route.ts",
    ].map((path) => Bun.file(new URL(path, repoRoot)).text()),
  );

const rolloutHarness = Bun.spawnSync({
  cmd: ["bash", "deploy/aws/test-article-rollout.sh"],
  cwd: repoRoot.pathname,
  stdout: "pipe",
  stderr: "pipe",
});

function assertOrdered(markers: string[]) {
  let cursor = -1;
  for (const marker of markers) {
    const next = deployScript.indexOf(marker, cursor + 1);
    expect(next).toBeGreaterThan(cursor);
    cursor = next;
  }
}

describe("article blue-green rollout contract", () => {
  it("preserves a closed gate through bootstrap and proves rollback failures", () => {
    expect(new TextDecoder().decode(rolloutHarness.stderr)).toBe("");
    expect(rolloutHarness.exitCode).toBe(0);
    expect(new TextDecoder().decode(rolloutHarness.stdout)).toContain(
      "article rollout failure-path tests passed",
    );
  });

  it("gates both mutation routes on API and custom-domain ingress", () => {
    expect(deployScript).toContain(
      '$0 == "api.cornershop.dev {" || $0 == "https:// {"',
    );
    expect(deployScript).toContain(
      "path /api/sites/*/articles /api/sites/*/articles/generate",
    );
    expect(deployScript).toContain(
      'for origin in "https://api.cornershop.dev" "https://cornershop.dev"',
    );
    expect(generateRoute).toContain("areArticleMutationsGated");
    expect(articleRoute).toContain("areArticleMutationsGated");
  });

  it("keeps the expand migration gated and transactionally compatible", () => {
    const executable = migration.replace(/^--.*$/gm, "").trim();
    expect(executable.startsWith("BEGIN;")).toBe(true);
    expect(executable.endsWith("COMMIT;")).toBe(true);
    expect(migration).toContain("'articles.mutations.gated'");
    expect(migration).toContain("'true'::jsonb");
    expect(migration).not.toContain('RENAME COLUMN "producedCount"');
  });

  it("drains before stopping the old worker and rechecks before candidate start", () => {
    assertOrdered([
      "set_article_edge_gate closed",
      "run_article_rollout close",
      "run db:migrate:deploy",
      "wait_for_article_quiescence",
      'docker stop "$container"',
      "run_article_rollout check",
      "run workflow:migrate",
      '--env CORNERSHOP_SKIP_STARTUP_MIGRATIONS=true',
      'wait_for_health "$candidate"',
      "operator:article-rollout --action check",
      'docker rename "$candidate" "$container"',
      "operator:article-rollout --action open",
      "set_article_edge_gate open",
      "verify_article_edge_gate open",
    ]);
    expect(entrypoint).toContain("CORNERSHOP_SKIP_STARTUP_MIGRATIONS");
  });

  it("keeps an incompatible rollback closed at both layers", () => {
    const rollback = deployScript.match(
      /rollback_article_rollout\(\) \{([\s\S]*?)\n\}/,
    )?.[1];
    expect(rollback).toBeDefined();
    expect(rollback).toContain("set_article_edge_gate closed");
    expect(rollback).toContain("verify_article_edge_gate closed");
    expect(rollback).toContain("run_article_rollout close");
    expect(rollback).toContain("leaving application containers stopped");
    expect(rollback).toContain('docker rename "$previous" "$container"');
    expect(rollback).not.toContain("set_article_edge_gate open");
    expect(rollback).not.toContain("run_article_rollout open");
  });
});
