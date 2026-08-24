import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { launch } from "chrome-launcher";
import lighthouse from "lighthouse";
import { browserPath } from "./browser-path.mjs";

const require = createRequire(import.meta.url);
const defaultRepoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const maxCollectionAttempts = 3;

export async function runLighthouseCi(options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot;
  const config =
    options.config ?? require(path.join(repoRoot, "lighthouserc.cjs"));
  const runtime = createRuntime(options.runtime);
  const collect = config.ci?.collect;
  const assertionConfig = config.ci?.assert;
  const upload = config.ci?.upload;

  assert(
    Array.isArray(collect?.url) && collect.url.length > 0,
    "Missing Lighthouse URLs",
  );
  assert(
    Number.isInteger(collect.numberOfRuns) && collect.numberOfRuns > 0,
    "Invalid Lighthouse run count",
  );
  assert(
    collect.startServerCommand === "bun run lighthouse:serve",
    "Lighthouse must run the standalone production server",
  );
  assert(
    Number.isFinite(collect.startServerReadyTimeout) &&
      collect.startServerReadyTimeout > 0,
    "Invalid Lighthouse server timeout",
  );
  assert(
    assertionConfig?.aggregationMethod === "median",
    "Only median aggregation is supported",
  );
  assert(
    assertionConfig.assertions &&
      typeof assertionConfig.assertions === "object",
    "Missing Lighthouse assertions",
  );
  assert(
    upload?.target === "filesystem",
    "Lighthouse artifacts must use the filesystem target",
  );

  const outputDir = path.resolve(repoRoot, upload.outputDir);
  const manifest = {
    schemaVersion: 1,
    status: "running",
    aggregationMethod: "median",
    numberOfRuns: collect.numberOfRuns,
    reports: [],
    assertions: [],
  };

  await runtime.rm(outputDir, { recursive: true, force: true });
  await runtime.mkdir(outputDir, { recursive: true });

  const server = runtime.spawn("bun", ["run", "lighthouse:serve"], {
    cwd: repoRoot,
    detached: runtime.platform !== "win32",
    env: runtime.env,
    stdio: "inherit",
  });
  let serverFailure;
  server.once("error", (error) => {
    serverFailure = error;
  });
  let chrome;
  let failure;

  try {
    await waitForServer(
      collect.url[0],
      collect.startServerReadyTimeout,
      server,
      () => serverFailure,
      runtime,
    );
    chrome = await runtime.launch({
      chromePath: runtime.browserPath(),
      chromeFlags: [
        "--headless=new",
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
      logLevel: "error",
    });

    for (const [urlIndex, url] of collect.url.entries()) {
      for (let run = 1; run <= collect.numberOfRuns; run += 1) {
        const { result, html, attempts } = await collectRun(
          url,
          run,
          chrome.port,
          runtime,
        );
        const basename = `${String(urlIndex + 1).padStart(2, "0")}-${routeSlug(url)}-run-${run}`;
        const jsonFile = `${basename}.report.json`;
        const htmlFile = `${basename}.report.html`;

        await Promise.all([
          runtime.writeFile(
            path.join(outputDir, jsonFile),
            `${JSON.stringify(result.lhr, null, 2)}\n`,
          ),
          runtime.writeFile(path.join(outputDir, htmlFile), html),
        ]);
        manifest.reports.push({
          url,
          requestedUrl: result.lhr.requestedUrl || url,
          run,
          collectionAttempts: attempts,
          jsonPath: jsonFile,
          htmlPath: htmlFile,
          lighthouseVersion: result.lhr.lighthouseVersion,
          summary: Object.fromEntries(
            Object.entries(result.lhr.categories).map(([id, category]) => [
              id,
              category.score,
            ]),
          ),
          representativeMetrics: {
            firstContentfulPaint:
              result.lhr.audits["first-contentful-paint"]?.numericValue || 0,
            interactive: result.lhr.audits.interactive?.numericValue || 0,
          },
          values: assertionValues(
            result.lhr,
            assertionConfig.assertions,
          ),
        });
      }
    }

    manifest.assertions = evaluateAssertions(
      manifest.reports,
      collect.url,
      assertionConfig.assertions,
      collect.numberOfRuns,
    );
    const failures = manifest.assertions.filter(
      (assertion) => !assertion.passed,
    );
    if (failures.length > 0) {
      throw new Error(
        `Lighthouse budgets failed:\n${failures.map((assertion) => `- ${assertion.url} ${assertion.id}: median ${assertion.median} ${assertion.expectation}`).join("\n")}`,
      );
    }

    for (const assertion of manifest.assertions) {
      runtime.stdoutWrite(
        `${assertion.url} ${assertion.id}: median ${assertion.median} ${assertion.expectation}\n`,
      );
    }
  } catch (error) {
    failure = error;
  }

  try {
    if (chrome) await chrome.kill();
  } catch (error) {
    failure ??= error;
  }

  try {
    await stopServer(server, runtime);
  } catch (error) {
    failure ??= error;
  }

  manifest.status = failure ? "failed" : "passed";
  if (failure) {
    manifest.error = {
      name: failure instanceof Error ? failure.name : "Error",
      message: failure instanceof Error ? failure.message : String(failure),
    };
  }

  await Promise.all([
    runtime.writeFile(
      path.join(outputDir, "manifest.json"),
      `${JSON.stringify(filesystemManifest(manifest.reports, collect.url, outputDir), null, 2)}\n`,
    ),
    runtime.writeFile(
      path.join(outputDir, "assertion-results.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
  ]);

  if (failure) throw failure;
  return manifest;
}

async function collectRun(url, run, port, runtime) {
  const failures = [];

  while (failures.length < maxCollectionAttempts) {
    try {
      const result = await runtime.lighthouse(url, {
        port,
        output: ["json", "html"],
        logLevel: "info",
      });
      assert(
        result?.lhr,
        `Lighthouse returned no result for ${url} run ${run}`,
      );
      assert(
        !result.lhr.runtimeError,
        `${url} run ${run} failed: ${JSON.stringify(result.lhr.runtimeError)}`,
      );

      const reports = Array.isArray(result.report)
        ? result.report
        : [result.report];
      const html = reports.find(
        (report) =>
          typeof report === "string" &&
          /<!doctype html>/i.test(report),
      );
      assert(html, `Lighthouse returned no HTML report for ${url} run ${run}`);
      return { result, html, attempts: failures.length + 1 };
    } catch (error) {
      failures.push(error);
      if (failures.length < maxCollectionAttempts) {
        runtime.stdoutWrite(
          `${url} run ${run} collection attempt ${failures.length} failed; retrying\n`,
        );
      }
    }
  }

  throw failures[0];
}

function createRuntime(overrides = {}) {
  return {
    browserPath,
    delay: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
    env: process.env,
    fetch: globalThis.fetch,
    killProcess: (pid, signal) => process.kill(pid, signal),
    launch,
    lighthouse,
    mkdir,
    now: () => Date.now(),
    platform: process.platform,
    rm,
    spawn,
    stdoutWrite: (message) => process.stdout.write(message),
    writeFile,
    ...overrides,
  };
}

function assertionValues(lhr, assertions) {
  return Object.fromEntries(
    Object.keys(assertions).map((id) => [id, lighthouseValue(lhr, id)]),
  );
}

function lighthouseValue(lhr, id) {
  const value = id.startsWith("categories:")
    ? lhr.categories[id.slice("categories:".length)]?.score
    : lhr.audits[id]?.numericValue;
  assert(
    typeof value === "number" && Number.isFinite(value),
    `Lighthouse result is missing numeric assertion value ${id}`,
  );
  return value;
}

function evaluateAssertions(reports, urls, assertions, numberOfRuns) {
  const results = [];
  for (const url of urls) {
    const urlReports = reports.filter((report) => report.url === url);
    for (const [id, [level, expectation]] of Object.entries(assertions)) {
      assert(
        level === "error",
        `Unsupported Lighthouse assertion level ${level} for ${id}`,
      );
      const values = urlReports.map((report) => report.values[id]);
      assert(
        values.length === numberOfRuns,
        `Missing Lighthouse runs for ${url} ${id}`,
      );
      const medianValue = median(values);
      const hasMin = typeof expectation.minScore === "number";
      const hasMax = typeof expectation.maxNumericValue === "number";
      assert(
        hasMin !== hasMax,
        `Unsupported Lighthouse expectation for ${id}`,
      );
      const passed = hasMin
        ? medianValue >= expectation.minScore
        : medianValue <= expectation.maxNumericValue;
      results.push({
        url,
        id,
        values,
        median: medianValue,
        expectation: hasMin
          ? `>= ${expectation.minScore}`
          : `<= ${expectation.maxNumericValue}`,
        passed,
      });
    }
  }
  return results;
}

function filesystemManifest(reports, urls, outputDir) {
  const representativeRuns = new Map(
    urls.flatMap((url) => {
      const urlReports = reports.filter((report) => report.url === url);
      return urlReports.length > 0
        ? [[url, representativeReport(urlReports).run]]
        : [];
    }),
  );

  return reports
    .map((report) => ({
      url: report.requestedUrl,
      isRepresentativeRun: representativeRuns.get(report.url) === report.run,
      htmlPath: path.join(outputDir, report.htmlPath),
      jsonPath: path.join(outputDir, report.jsonPath),
      summary: report.summary,
    }))
    .sort(
      (left, right) =>
        Number(left.isRepresentativeRun) -
        Number(right.isRepresentativeRun),
    );
}

function representativeReport(reports) {
  assert(reports.length > 0, "Missing Lighthouse reports for manifest");
  const medianFirstContentfulPaint = median(
    reports.map(
      (report) => report.representativeMetrics.firstContentfulPaint,
    ),
  );
  const medianInteractive = median(
    reports.map((report) => report.representativeMetrics.interactive),
  );

  return [...reports].sort((left, right) => {
    const leftDistance = representativeDistance(
      left,
      medianFirstContentfulPaint,
      medianInteractive,
    );
    const rightDistance = representativeDistance(
      right,
      medianFirstContentfulPaint,
      medianInteractive,
    );
    return leftDistance - rightDistance;
  })[0];
}

function representativeDistance(
  report,
  medianFirstContentfulPaint,
  medianInteractive,
) {
  const firstContentfulPaintDistance =
    medianFirstContentfulPaint -
    report.representativeMetrics.firstContentfulPaint;
  const interactiveDistance =
    medianInteractive - report.representativeMetrics.interactive;
  return (
    firstContentfulPaintDistance * firstContentfulPaintDistance +
    interactiveDistance * interactiveDistance
  );
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

async function waitForServer(
  url,
  timeout,
  child,
  getSpawnFailure,
  runtime,
) {
  const deadline = runtime.now() + timeout;
  while (runtime.now() < deadline) {
    const spawnFailure = getSpawnFailure();
    if (spawnFailure) throw spawnFailure;
    if (child.exitCode !== null) {
      throw new Error(
        `Lighthouse server exited early with status ${child.exitCode}`,
      );
    }
    try {
      const response = await runtime.fetch(url);
      if (response.ok) return;
    } catch {
      // The standalone server is still starting.
    }
    await runtime.delay(100);
  }
  throw new Error(`Lighthouse server did not become ready at ${url}`);
}

async function stopServer(child, runtime) {
  if (child.exitCode !== null || !child.pid) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  if (child.exitCode !== null) return;
  if (!signalProcess(child, "SIGTERM", runtime)) return;
  const timedOut = await Promise.race([
    exited.then(() => false),
    runtime.delay(5_000).then(() => true),
  ]);
  if (timedOut && child.exitCode === null) {
    if (!signalProcess(child, "SIGKILL", runtime)) return;
    await exited;
  }
}

function signalProcess(child, signal, runtime) {
  try {
    if (runtime.platform === "win32") child.kill(signal);
    else runtime.killProcess(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function routeSlug(url) {
  const pathname = new URL(url).pathname;
  return pathname === "/"
    ? "root"
    : pathname.replace(/^\/|\/$/g, "").replaceAll("/", "-");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

if (import.meta.main) await runLighthouseCi();
