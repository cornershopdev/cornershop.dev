import { describe, expect, it } from "bun:test";

const repoRoot = new URL("../..", import.meta.url);

async function readRepoFile(relativePath: string): Promise<string> {
  return Bun.file(new URL(relativePath, repoRoot)).text();
}

type DependabotUpdate = {
  "package-ecosystem": string;
  directory: string;
  schedule: { interval: string };
  "open-pull-requests-limit": number;
  allow: Array<{
    "dependency-name": string;
    "update-types": string[];
  }>;
  groups: Record<
    string,
    {
      "applies-to": string;
      patterns: string[];
      "update-types": string[];
    }
  >;
  ignore?: unknown;
};

type DependabotConfig = {
  version: number;
  updates: DependabotUpdate[];
};

type WorkflowStep = {
  name?: string;
  uses?: string;
  if?: string;
  shell?: string;
  run?: string;
  with?: Record<string, unknown>;
};

type AuditWorkflow = {
  on: {
    pull_request: { paths: string[] };
    push: { branches: string[]; paths: string[] };
    schedule: Array<{ cron: string }>;
    workflow_dispatch: null;
  };
  permissions: Record<string, string>;
  jobs: {
    audit: {
      "runs-on": string;
      permissions?: unknown;
      steps: WorkflowStep[];
    };
  };
};

const [dependabotSource, workflowSource] = await Promise.all([
  readRepoFile(".github/dependabot.yml"),
  readRepoFile(".github/workflows/dependency-audit.yml"),
]);
const dependabot = Bun.YAML.parse(dependabotSource) as DependabotConfig;
const workflow = Bun.YAML.parse(workflowSource) as AuditWorkflow;

describe("dependency update governance", () => {
  it("keeps every ecosystem on one grouped weekly patch/minor lane", () => {
    expect(dependabot.version).toBe(2);
    expect(
      dependabot.updates.map((update) => update["package-ecosystem"]),
    ).toEqual(["bun", "docker", "github-actions"]);
    expect(dependabotSource).not.toContain("npm");
    expect(dependabotSource).not.toMatch(
      /package-ecosystem:\s*["']?npm\b/,
    );

    for (const update of dependabot.updates) {
      expect(update.directory).toBe("/");
      expect(update.schedule.interval).toBe("weekly");
      expect(update["open-pull-requests-limit"]).toBe(1);
      expect(update.allow).toEqual([
        {
          "dependency-name": "*",
          "update-types": [
            "version-update:semver-patch",
            "version-update:semver-minor",
          ],
        },
      ]);
      expect(update.groups).toEqual({
        "routine-patch-minor": {
          "applies-to": "version-updates",
          patterns: ["*"],
          "update-types": ["patch", "minor"],
        },
      });
      expect(update.ignore).toBeUndefined();
      expect(JSON.stringify(update)).not.toContain("semver-major");
    }
  });
});

describe("dependency audit workflow", () => {
  it("runs with the bounded event and least-privilege contract", () => {
    const dependencyPaths = [
      "package.json",
      "bun.lock",
      "bunfig.toml",
      "Dockerfile",
      ".github/dependabot.yml",
      ".github/workflows/**",
    ];

    expect(workflow.on.pull_request.paths).toEqual(dependencyPaths);
    expect(workflow.on.push).toEqual({
      branches: ["main"],
      paths: dependencyPaths,
    });
    expect(workflow.on.schedule).toEqual([{ cron: "17 4 * * *" }]);
    expect("workflow_dispatch" in workflow.on).toBe(true);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(workflow.jobs)).toEqual(["audit"]);
    expect(workflow.jobs.audit["runs-on"]).toBe("ubuntu-latest");
    expect(workflow.jobs.audit.permissions).toBeUndefined();
  });

  it("pins the safe install, fail-closed audit, and always-upload steps", () => {
    const steps = workflow.jobs.audit.steps;
    const checkout = steps.find(
      (step) => step.uses === "actions/checkout@v7",
    );
    const setupBun = steps.find(
      (step) => step.uses === "oven-sh/setup-bun@v2",
    );
    const install = steps.find(
      (step) => step.run === "bun install --frozen-lockfile --ignore-scripts",
    );
    const audit = steps.find(
      (step) => step.name === "Audit locked dependencies",
    );
    const upload = steps.find(
      (step) => step.uses === "actions/upload-artifact@v7",
    );

    expect(steps.flatMap((step) => (step.uses ? [step.uses] : []))).toEqual([
      "actions/checkout@v7",
      "oven-sh/setup-bun@v2",
      "actions/upload-artifact@v7",
    ]);
    expect(checkout?.with).toEqual({ "persist-credentials": false });
    expect(setupBun?.with).toEqual({ "bun-version": "1.3.14" });
    expect(install).toBeDefined();
    expect(audit?.shell).toBe("bash");
    expect(audit?.run?.trim()).toBe(
      "set -o pipefail\nbun audit --json | tee bun-audit.json",
    );
    expect(upload?.if).toBe("always()");
    expect(upload?.with).toEqual({
      name: "bun-audit-json",
      path: "bun-audit.json",
      "if-no-files-found": "error",
    });
  });

  it("does not introduce privileged, filtered, or failure-swallowing paths", () => {
    for (const forbidden of [
      "pull_request_target",
      "github.token",
      "GITHUB_TOKEN",
      "BUN_AUTH_TOKEN",
      "NPM_CONFIG_USERCONFIG",
      "_authToken",
      "registry-url",
      "registries:",
      "token:",
      "username:",
      "password:",
      "contents: write",
      "id-token: write",
      "--audit-level",
      "--omit",
      "--prod",
      "continue-on-error",
      "set +e",
    ]) {
      expect(workflowSource).not.toContain(forbidden);
    }
    expect(workflowSource).not.toMatch(/\$\{\{\s*secrets\./);
    expect(workflowSource).not.toMatch(
      /\bbun audit\b[^\n]*--ignore(?:\s|=)/,
    );
    expect(workflowSource).not.toContain("||");
    expect(workflowSource).not.toMatch(/;\s*(?:exit\s+0|true|:)\s*$/m);
  });
});
