import { describe, expect, it, mock } from "bun:test";
import { EventEmitter } from "node:events";
import path from "node:path";

type MetricValues = {
  performance: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;
  totalBlockingTime: number;
  firstContentfulPaint?: number;
  interactive?: number;
};

type RunnerModule = {
  runLighthouseCi: (options: unknown) => Promise<unknown>;
};

type ArtifactManifest = {
  status: "running" | "passed" | "failed";
  error?: { name: string; message: string };
  reports: Array<{ collectionAttempts: number }>;
  assertions: Array<{
    id: string;
    values: number[];
    median: number;
    passed: boolean;
  }>;
};

type LegacyManifestEntry = {
  url: string;
  isRepresentativeRun: boolean;
  htmlPath: string;
  jsonPath: string;
  summary: Record<string, number>;
};

const runnerUrl = new URL(
  "../../scripts/run-lighthouse.mjs",
  import.meta.url,
).href;
const { runLighthouseCi } = (await import(runnerUrl)) as RunnerModule;

describe("Lighthouse runner", () => {
  it("retries a transient collection failure up to three times", async () => {
    const harness = createHarness([
      new Error("transient collection failure 1"),
      new Error("transient collection failure 2"),
      passingMetrics(),
    ]);

    await harness.run(config(1));

    expect(harness.lighthouse).toHaveBeenCalledTimes(3);
    expect(harness.assertionResults().status).toBe("passed");
    expect(harness.assertionResults().reports).toMatchObject([
      { collectionAttempts: 3 },
    ]);
    expect(harness.legacyManifest()).toHaveLength(1);
    expect(harness.browserKill).toHaveBeenCalledTimes(1);
    expect(harness.serverSignals).toEqual(["SIGTERM"]);
  });

  it("fails with the first collection error after three attempts", async () => {
    const harness = createHarness([
      new Error("first collection failure"),
      new Error("second collection failure"),
      new Error("third collection failure"),
    ]);

    await expect(harness.run(config(1))).rejects.toThrow(
      "first collection failure",
    );

    expect(harness.lighthouse).toHaveBeenCalledTimes(3);
    expect(harness.assertionResults()).toMatchObject({
      status: "failed",
      error: { name: "Error", message: "first collection failure" },
      reports: [],
      assertions: [],
    });
    expect(harness.legacyManifest()).toEqual([]);
    expect(harness.browserKill).toHaveBeenCalledTimes(1);
    expect(harness.serverSignals).toEqual(["SIGTERM"]);
  });

  it("passes budgets from the median of the scheduled runs", async () => {
    const harness = createHarness([
      passingMetrics({ performance: 0.89, largestContentfulPaint: 3_900 }),
      passingMetrics({ performance: 0.91, largestContentfulPaint: 3_700 }),
      passingMetrics({ performance: 0.95, largestContentfulPaint: 3_500 }),
    ]);

    await harness.run(config(3));

    expect(harness.lighthouse).toHaveBeenCalledTimes(3);
    const result = harness.assertionResults();
    expect(result.status).toBe("passed");
    expect(result.assertions.find(({ id }) => id === "categories:performance"))
      .toMatchObject({
        values: [0.89, 0.91, 0.95],
        median: 0.91,
        passed: true,
      });
    expect(
      result.assertions.find(
        ({ id }) => id === "largest-contentful-paint",
      ),
    ).toMatchObject({
      values: [3_900, 3_700, 3_500],
      median: 3_700,
      passed: true,
    });
    const legacyManifest = harness.legacyManifest();
    expect(legacyManifest).toHaveLength(3);
    expect(
      legacyManifest.filter(({ isRepresentativeRun }) => isRepresentativeRun),
    ).toHaveLength(1);
    expect(legacyManifest.at(-1)?.isRepresentativeRun).toBe(true);
    expect(legacyManifest[0]?.htmlPath).toStartWith(
      "/virtual/repo/.lighthouseci/",
    );
  });

  it("records failed median assertions without retrying their budget failure", async () => {
    const harness = createHarness([
      passingMetrics({ largestContentfulPaint: 3_500 }),
      passingMetrics({ largestContentfulPaint: 3_900 }),
      passingMetrics({ largestContentfulPaint: 4_100 }),
    ]);

    await expect(harness.run(config(3))).rejects.toThrow(
      "Lighthouse budgets failed",
    );

    expect(harness.lighthouse).toHaveBeenCalledTimes(3);
    const result = harness.assertionResults();
    expect(result.status).toBe("failed");
    expect(result.error?.message).toContain(
      "largest-contentful-paint: median 3900 <= 3800",
    );
    expect(
      result.assertions.find(
        ({ id }) => id === "largest-contentful-paint",
      ),
    ).toMatchObject({
      values: [3_500, 3_900, 4_100],
      median: 3_900,
      passed: false,
    });
    expect(harness.legacyManifest()).toHaveLength(3);
    expect(harness.browserKill).toHaveBeenCalledTimes(1);
    expect(harness.serverSignals).toEqual(["SIGTERM"]);
  });
});

function config(numberOfRuns: number) {
  return {
    ci: {
      collect: {
        url: ["http://127.0.0.1:4173/"],
        numberOfRuns,
        startServerCommand: "bun run lighthouse:serve",
        startServerReadyTimeout: 1_000,
      },
      assert: {
        aggregationMethod: "median",
        assertions: {
          "categories:performance": ["error", { minScore: 0.9 }],
          "largest-contentful-paint": [
            "error",
            { maxNumericValue: 3_800 },
          ],
          "cumulative-layout-shift": [
            "error",
            { maxNumericValue: 0.1 },
          ],
          "total-blocking-time": [
            "error",
            { maxNumericValue: 200 },
          ],
        },
      },
      upload: { target: "filesystem", outputDir: ".lighthouseci" },
    },
  };
}

function passingMetrics(overrides: Partial<MetricValues> = {}): MetricValues {
  return {
    performance: 0.95,
    largestContentfulPaint: 3_000,
    cumulativeLayoutShift: 0.05,
    totalBlockingTime: 100,
    firstContentfulPaint: 1_000,
    interactive: 2_000,
    ...overrides,
  };
}

function lighthouseResult(url: string, values: MetricValues) {
  return {
    lhr: {
      requestedUrl: url,
      lighthouseVersion: "13.4.1",
      categories: {
        performance: { score: values.performance },
      },
      audits: {
        "largest-contentful-paint": {
          numericValue: values.largestContentfulPaint,
        },
        "cumulative-layout-shift": {
          numericValue: values.cumulativeLayoutShift,
        },
        "total-blocking-time": {
          numericValue: values.totalBlockingTime,
        },
        "first-contentful-paint": {
          numericValue: values.firstContentfulPaint,
        },
        interactive: { numericValue: values.interactive },
      },
    },
    report: [
      "<!-- Lighthouse license header -->\n<!doctype html><html><body>report</body></html>",
    ],
  };
}

function createHarness(outcomes: Array<MetricValues | Error>) {
  const pending = [...outcomes];
  const artifacts = new Map<string, string>();
  const serverSignals: string[] = [];
  const server = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    pid: 4_173,
    kill: mock(() => true),
  });
  const browserKill = mock(async () => undefined);
  const lighthouse = mock(async (url: string) => {
    const outcome = pending.shift();
    if (!outcome) throw new Error("Missing Lighthouse test outcome");
    if (outcome instanceof Error) throw outcome;
    return lighthouseResult(url, outcome);
  });
  const killProcess = mock((_pid: number, signal: string) => {
    serverSignals.push(signal);
    server.exitCode = 0;
    server.emit("exit", 0);
  });
  const runtime = {
    browserPath: () => "/fake/chrome",
    delay: () => new Promise<never>(() => undefined),
    env: {},
    fetch: mock(async () => ({ ok: true })),
    killProcess,
    launch: mock(async () => ({ port: 9_222, kill: browserKill })),
    lighthouse,
    mkdir: mock(async () => undefined),
    now: () => 0,
    platform: "darwin",
    rm: mock(async () => undefined),
    spawn: mock(() => server),
    stdoutWrite: mock(() => true),
    writeFile: mock(async (file: string, contents: string) => {
      artifacts.set(path.basename(file), String(contents));
    }),
  };

  return {
    assertionResults: () =>
      JSON.parse(artifacts.get("assertion-results.json")!) as ArtifactManifest,
    browserKill,
    legacyManifest: () =>
      JSON.parse(
        artifacts.get("manifest.json")!,
      ) as LegacyManifestEntry[],
    lighthouse,
    run: (runnerConfig: ReturnType<typeof config>) =>
      runLighthouseCi({
        config: runnerConfig,
        repoRoot: "/virtual/repo",
        runtime,
      }),
    serverSignals,
  };
}
