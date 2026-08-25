import { describe, expect, it } from "bun:test";
import {
  BUN_DEPENDENCY_SNAPSHOT_CORRELATOR,
  BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME,
  BUN_DEPENDENCY_SNAPSHOT_SUBMIT_JOB,
  BUN_DEPENDENCY_SNAPSHOT_VALIDATE_JOB,
  BUN_DEPENDENCY_SNAPSHOT_WORKFLOW_NAME,
} from "@/lib/bun-dependency-snapshot";

const repoRoot = new URL("../..", import.meta.url);

async function readRepoFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, repoRoot)).text();
}

type WorkflowStep = {
  name?: string;
  uses?: string;
  if?: string;
  shell?: string;
  run?: string;
  env?: Record<string, unknown>;
  with?: Record<string, unknown>;
};

type SnapshotWorkflow = {
  name: string;
  on: {
    pull_request: { paths: string[] };
    push: { branches: string[]; paths: string[] };
    schedule: Array<{ cron: string }>;
    workflow_dispatch: null;
  };
  permissions: Record<string, string>;
  jobs: {
    validate: {
      "runs-on": string;
      permissions?: Record<string, string>;
      steps: WorkflowStep[];
    };
    submit: {
      if: string;
      needs: string;
      "runs-on": string;
      permissions: Record<string, string>;
      steps: WorkflowStep[];
    };
  };
};

const [workflowSource, scriptSource] = await Promise.all([
  readRepoFile(".github/workflows/bun-dependency-snapshot.yml"),
  readRepoFile("scripts/build-bun-dependency-snapshot.ts"),
]);
const workflow = Bun.YAML.parse(workflowSource) as SnapshotWorkflow;

const snapshotPaths = [
  "package.json",
  "bun.lock",
  "src/lib/bun-dependency-snapshot.ts",
  "src/lib/bun-dependency-snapshot.test.ts",
  "src/lib/bun-dependency-snapshot-contract.test.ts",
  "scripts/build-bun-dependency-snapshot.ts",
  ".github/workflows/bun-dependency-snapshot.yml",
];

describe("bun dependency snapshot workflow", () => {
  it("keeps a stable detector correlator and trusted-only submit job", () => {
    expect(workflow.name).toBe(BUN_DEPENDENCY_SNAPSHOT_WORKFLOW_NAME);
    expect(Object.keys(workflow.jobs)).toEqual([
      BUN_DEPENDENCY_SNAPSHOT_VALIDATE_JOB,
      BUN_DEPENDENCY_SNAPSHOT_SUBMIT_JOB,
    ]);
    expect(
      `${workflow.name} ${BUN_DEPENDENCY_SNAPSHOT_SUBMIT_JOB}`,
    ).toBe(BUN_DEPENDENCY_SNAPSHOT_CORRELATOR);
    expect(BUN_DEPENDENCY_SNAPSHOT_DETECTOR_NAME).toBe(
      "cornershopdev-bun-lockfile",
    );
    expect(workflow.jobs.submit.if).toBe(
      "${{ github.ref == 'refs/heads/main' && (github.event_name == 'push' || github.event_name == 'schedule' || github.event_name == 'workflow_dispatch') }}",
    );
    expect(workflow.jobs.submit.needs).toBe("validate");
  });

  it("runs with the bounded event and least-privilege contract", () => {
    expect(workflow.on.pull_request.paths).toEqual(snapshotPaths);
    expect(workflow.on.push).toEqual({
      branches: ["main"],
      paths: snapshotPaths,
    });
    expect(workflow.on.schedule).toEqual([{ cron: "47 4 * * *" }]);
    expect("workflow_dispatch" in workflow.on).toBe(true);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.validate["runs-on"]).toBe("ubuntu-latest");
    expect(workflow.jobs.validate.permissions).toBeUndefined();
    expect(workflow.jobs.submit["runs-on"]).toBe("ubuntu-latest");
    expect(workflow.jobs.submit.permissions).toEqual({ contents: "write" });
  });

  it("pins the lockfile-only parser, evidence upload, and trusted submit steps", () => {
    const validateSteps = workflow.jobs.validate.steps;
    const submitSteps = workflow.jobs.submit.steps;
    const checkout = validateSteps.find(
      (step) => step.uses === "actions/checkout@v7",
    );
    const setupBun = validateSteps.find(
      (step) => step.uses === "oven-sh/setup-bun@v2",
    );
    const tests = validateSteps.find(
      (step) => step.name === "Check snapshot parser and permission contract",
    );
    const build = validateSteps.find(
      (step) => step.name === "Build lockfile snapshot",
    );
    const upload = validateSteps.find(
      (step) => step.uses === "actions/upload-artifact@v7",
    );
    const submit = submitSteps.find(
      (step) => step.name === "Submit snapshot to GitHub",
    );

    expect(
      validateSteps.flatMap((step) => (step.uses ? [step.uses] : [])),
    ).toEqual([
      "actions/checkout@v7",
      "oven-sh/setup-bun@v2",
      "actions/upload-artifact@v7",
    ]);
    expect(
      submitSteps.flatMap((step) => (step.uses ? [step.uses] : [])),
    ).toEqual(["actions/checkout@v7", "oven-sh/setup-bun@v2"]);
    expect(checkout?.with).toEqual({ "persist-credentials": false });
    expect(setupBun?.with).toEqual({ "bun-version": "1.3.14" });
    expect(tests?.run).toBe(
      "bun test src/lib/bun-dependency-snapshot.test.ts src/lib/bun-dependency-snapshot-contract.test.ts",
    );
    expect(build?.run).toBe(
      "bun scripts/build-bun-dependency-snapshot.ts --output bun-dependency-snapshot.json",
    );
    expect(upload?.if).toBe("always()");
    expect(upload?.with).toEqual({
      name: "bun-dependency-snapshot",
      path: "bun-dependency-snapshot.json",
      "if-no-files-found": "warn",
    });
    expect(submit?.env).toEqual({ GITHUB_TOKEN: "${{ github.token }}" });
    expect(submit?.shell).toBe("bash");
    expect(submit?.run).toContain("set -euo pipefail");
    expect(submit?.run).toContain("/dependency-graph/snapshots");
    expect(submit?.run).toContain("X-GitHub-Api-Version: 2026-03-10");
    expect(submit?.run).toContain("--data-binary @bun-dependency-snapshot.json");
    expect(submit?.run).toContain('http_code}" != "201"');
    expect(submit?.run).toContain('result}" == "INVALID"');
  });

  it("does not introduce privileged, registry, or failure-swallowing paths", () => {
    for (const forbidden of [
      "pull_request_target",
      "secrets.",
      "BUN_AUTH_TOKEN",
      "NPM_CONFIG_USERCONFIG",
      "_authToken",
      "registry-url",
      "registries:",
      "id-token: write",
      "packages: write",
      "pull-requests: write",
      "actions: write",
      "continue-on-error",
      "set +e",
      "bun install",
      "persist-credentials: true",
      "token:",
      "npx ",
      "npm ",
      "yarn ",
      "pnpm ",
    ]) {
      expect(workflowSource).not.toContain(forbidden);
    }
    expect(workflowSource).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflowSource.match(/contents:\s*write/g)).toEqual([
      "contents: write",
    ]);
    expect(workflow.jobs.validate.permissions).toBeUndefined();
    expect(scriptSource).not.toContain("bun install");
    expect(scriptSource).not.toContain("dependency-graph/snapshots");
  });
});
