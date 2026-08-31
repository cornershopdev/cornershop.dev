#!/usr/bin/env bun

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { chromium, type Page } from "@playwright/test";

const repoRoot = resolve(import.meta.dir, "..");
const skillRoot = join(repoRoot, ".cursor/skills/verify-restofront");
const artifactRoot = join(skillRoot, "artifacts");
const appOrigin = "http://127.0.0.1:3100";
const providerOrigin = "http://127.0.0.1:4100";
const stateDirectory = join(
  tmpdir(),
  "restofront-ctl",
  createHash("sha256").update(repoRoot).digest("hex").slice(0, 16),
);
const statePath = join(stateDirectory, "state.json");

type ServiceName = "app" | "fakeProviders";

type ManagedService = {
  command: string[];
  expectedCommandText: string;
  logPath: string;
  pid: number;
  port: number;
  processGroupId: number;
};

type RunState = {
  artifactDirectory: string;
  buildId: string;
  gitHead: string;
  repoRoot: string;
  runId: string;
  schemaVersion: 1;
  services: Record<ServiceName, ManagedService>;
  startedAt: string;
};

type DriveName = "factory-home" | "restaurant-themes" | "first-customer";

type CliOptions = {
  command: string;
  dryRun: boolean;
  json: boolean;
  positionals: string[];
};

type JsonRecord = Record<string, unknown>;

class CliError extends Error {
  constructor(
    message: string,
    readonly details: JsonRecord = {},
  ) {
    super(message);
  }
}

const options = parseOptions(process.argv.slice(2));

try {
  const result = await run(options);
  emit({ ok: true, ...result }, options.json);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown failure";
  const details = error instanceof CliError ? error.details : {};
  emit({ ok: false, command: options.command, error: message, ...details }, true, true);
  process.exitCode = 1;
}

async function run(cli: CliOptions): Promise<JsonRecord> {
  switch (cli.command) {
    case "up":
    case "launch":
      return launch(cli.dryRun);
    case "doctor":
      return doctor(cli.dryRun);
    case "down":
    case "cleanup":
      return cleanup(cli.dryRun);
    case "drive":
      return drive(parseDriveName(cli.positionals), cli.dryRun);
    case "help":
      return {
        command: "help",
        usage: [
          "bun scripts/restofront-ctl.ts up [--dry-run] [--json]",
          "bun scripts/restofront-ctl.ts doctor [--json]",
          "bun scripts/restofront-ctl.ts drive factory-home [--dry-run] [--json]",
          "bun scripts/restofront-ctl.ts drive restaurant-themes [--dry-run] [--json]",
          "bun scripts/restofront-ctl.ts drive first-customer [--dry-run] [--json]",
          "bun scripts/restofront-ctl.ts down [--dry-run] [--json]",
        ],
      };
    default:
      throw new CliError(`Unknown command: ${cli.command}`, {
        usage: "Run bun scripts/restofront-ctl.ts help --json.",
      });
  }
}

function parseOptions(args: string[]): CliOptions {
  const dryRun = args.includes("--dry-run");
  const json = args.includes("--json");
  const positionals = args.filter((arg) => arg !== "--dry-run" && arg !== "--json");
  return {
    command: positionals.shift() ?? "help",
    dryRun,
    json,
    positionals,
  };
}

function parseDriveName(args: string[]): DriveName {
  const name = args[0];
  if (
    name !== "factory-home" &&
    name !== "restaurant-themes" &&
    name !== "first-customer"
  ) {
    throw new CliError("Drive requires a supported feature name.", {
      supported: ["factory-home", "restaurant-themes", "first-customer"],
    });
  }
  if (args.length !== 1) {
    throw new CliError("Drive accepts exactly one feature name.");
  }
  return name;
}

async function launch(dryRun: boolean): Promise<JsonRecord> {
  const buildId = readBuildId();
  const gitHead = readGitHead();
  assertSafeDatabaseUrl(process.env.DATABASE_URL);

  const existing = readState();
  if (existing) {
    if (dryRun) {
      return {
        command: "up",
        dryRun: true,
        blockedByRecordedState: true,
        runId: existing.runId,
        statePath,
      };
    }
    const health = await inspectState(existing);
    if (health.healthy) {
      throw new CliError("A managed Restofront instance is already healthy.", {
        statePath,
        runId: existing.runId,
      });
    }
    if (!dryRun) await stopState(existing);
  }

  const occupied = [3100, 4100].flatMap((port) =>
    listenerPids(port).map((pid) => ({ pid, port })),
  );
  if (occupied.length > 0) {
    throw new CliError("Required ports are occupied by an unmanaged process.", {
      occupied,
    });
  }

  const commands = {
    app: ["bun", "run", "start"],
    fakeProviders: ["bun", "tests/e2e/support/fake-providers.ts"],
  };
  if (dryRun) {
    return {
      command: "up",
      dryRun: true,
      buildId,
      gitHead,
      ports: [3100, 4100],
      commands,
      statePath,
    };
  }

  const runId = timestampId();
  const artifactDirectory = join(artifactRoot, runId);
  mkdirSync(artifactDirectory, { recursive: true });
  const started: ManagedService[] = [];

  try {
    const fakeProviders = startService({
      command: commands.fakeProviders,
      expectedCommandText: "fake-providers.ts",
      logPath: join(artifactDirectory, "fake-providers.log"),
      port: 4100,
    });
    started.push(fakeProviders);
    await waitForJson(`${providerOrigin}/_health`, "ok", true, 30_000);

    const app = startService({
      command: commands.app,
      expectedCommandText: "bun run start",
      logPath: join(artifactDirectory, "app.log"),
      port: 3100,
    });
    started.push(app);
    await waitForJson(`${appOrigin}/api/health/live`, "status", "live", 60_000);

    const state: RunState = {
      artifactDirectory,
      buildId,
      gitHead,
      repoRoot,
      runId,
      schemaVersion: 1,
      services: { app, fakeProviders },
      startedAt: new Date().toISOString(),
    };
    writeState(state);
    return {
      command: "up",
      dryRun: false,
      runId,
      buildId,
      gitHead,
      artifactDirectory: relative(repoRoot, artifactDirectory),
      services: state.services,
      statePath,
    };
  } catch (error) {
    for (const service of started.reverse()) await stopService(service);
    throw error;
  }
}

async function doctor(dryRun: boolean): Promise<JsonRecord> {
  const state = readState();
  if (!state) {
    throw new CliError("No managed Restofront instance is recorded.", {
      dryRun,
      statePath,
      occupiedPorts: [3100, 4100].filter((port) => listenerPids(port).length > 0),
    });
  }
  const inspection = await inspectState(state);
  if (!inspection.healthy) {
    throw new CliError("The managed Restofront instance failed doctor checks.", {
      dryRun,
      ...inspection,
    });
  }
  return { command: "doctor", dryRun, ...inspection };
}

async function cleanup(dryRun: boolean): Promise<JsonRecord> {
  const state = readState();
  if (!state) {
    return {
      command: "down",
      dryRun,
      stopped: [],
      statePath,
      note: "No managed instance was recorded. No process was killed.",
    };
  }
  if (dryRun) {
    return {
      command: "down",
      dryRun: true,
      runId: state.runId,
      wouldStop: Object.entries(state.services).map(([name, service]) => ({
        name,
        pid: service.pid,
        processGroupId: service.processGroupId,
        port: service.port,
      })),
      evidencePreservedAt: relative(repoRoot, state.artifactDirectory),
    };
  }
  const stopped = await stopState(state);
  return {
    command: "down",
    dryRun: false,
    runId: state.runId,
    stopped,
    portsFree: [3100, 4100].every((port) => listenerPids(port).length === 0),
    evidencePreservedAt: relative(repoRoot, state.artifactDirectory),
  };
}

async function drive(name: DriveName, dryRun: boolean): Promise<JsonRecord> {
  if (name === "first-customer") return driveFirstCustomer(dryRun);

  const plan = publicDrivePlan(name);
  if (dryRun) {
    const recordedState = readState();
    return {
      command: "drive",
      feature: name,
      dryRun: true,
      route: plan.route,
      actions: plan.actions,
      expected: plan.expected,
      skipped: plan.skipped,
      recordedRunId: recordedState?.runId ?? null,
      artifactDirectory: recordedState
        ? relative(repoRoot, recordedState.artifactDirectory)
        : null,
    };
  }

  const state = requireHealthyState(await doctor(false));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ baseURL: appOrigin });
  const page = await context.newPage();
  const actionPath = join(state.artifactDirectory, `${name}.action.png`);
  const resultPath = join(state.artifactDirectory, `${name}.result.png`);

  try {
    const outcome =
      name === "factory-home"
        ? await driveFactoryHome(page, actionPath, resultPath)
        : await driveRestaurantThemes(page, actionPath, resultPath);
    const screenshots = [actionPath, resultPath, ...outcome.additionalScreenshots].map(
      (path) => relative(repoRoot, path),
    );
    const evidence = {
      schemaVersion: 1,
      feature: name,
      route: plan.route,
      actions: plan.actions,
      expected: plan.expected,
      skipped: plan.skipped,
      observations: outcome.observations,
      screenshots,
      buildId: state.buildId,
      gitHead: state.gitHead,
      runId: state.runId,
      generatedAt: new Date().toISOString(),
    };
    const evidencePath = join(state.artifactDirectory, `${name}.json`);
    writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    return {
      command: "drive",
      feature: name,
      dryRun: false,
      evidence: relative(repoRoot, evidencePath),
      screenshots: evidence.screenshots,
      skipped: plan.skipped,
      observations: outcome.observations,
    };
  } finally {
    await browser.close();
  }
}

async function driveFactoryHome(
  page: Page,
  actionPath: string,
  resultPath: string,
): Promise<{ additionalScreenshots: string[]; observations: JsonRecord }> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await visibleHeading(page, "The system behind your next local website.");
  await page.screenshot({ path: actionPath, fullPage: true });
  await page.getByRole("link", { name: "Build a local site", exact: true }).click();
  await page.waitForURL(`${appOrigin}/create`);
  await visibleHeading(page, "Build the first version.");
  const source = page.getByLabel("Restaurant website or name", { exact: true });
  await source.fill("restaurant.example");
  await page.screenshot({ path: resultPath, fullPage: true });
  return {
    additionalScreenshots: [],
    observations: {
      initialHeading: "The system behind your next local website.",
      finalHeading: "Build the first version.",
      finalUrl: page.url(),
      enteredSource: await source.inputValue(),
      buildPreviewEnabled: await page
        .getByRole("button", { name: "Build preview", exact: true })
        .isEnabled(),
    },
  };
}

async function driveRestaurantThemes(
  page: Page,
  actionPath: string,
  resultPath: string,
): Promise<{ additionalScreenshots: string[]; observations: JsonRecord }> {
  await page.goto("/themes/restaurant", { waitUntil: "domcontentloaded" });
  await visibleHeading(page, "The restaurant decides the theme.");
  const themeHeadings = page.locator("#themes article h3");
  const themeCount = await themeHeadings.count();
  if (themeCount !== 7) {
    throw new CliError("The restaurant theme gallery did not show seven themes.", {
      observedThemeCount: themeCount,
    });
  }
  await page.screenshot({ path: actionPath, fullPage: true });
  await page.getByRole("button", { name: "Theme details", exact: true }).first().click();
  await page.waitForURL(`${appOrigin}/themes/restaurant/terroir-editorial`);
  await visibleHeading(page, "Terroir Editorial");
  await page.screenshot({ path: resultPath, fullPage: true });
  const detailUrl = page.url();

  const previewPath = actionPath.replace(".action.png", ".preview.png");
  const previewPagePromise = page.context().waitForEvent("page");
  await page
    .getByRole("button", { name: "Open full website preview", exact: true })
    .click();
  const previewPage = await previewPagePromise;
  await previewPage.waitForLoadState("domcontentloaded");
  await visibleHeading(previewPage, "Maison Serein");
  await previewPage
    .locator('[data-site-theme="terroir-editorial"]')
    .first()
    .waitFor({ state: "visible" });
  await previewPage.screenshot({ path: previewPath, fullPage: true });
  const previewUrl = previewPage.url();
  await previewPage.close();

  const createPath = actionPath.replace(".action.png", ".create.png");
  await page
    .getByRole("main")
    .getByRole("button", { name: "Build a preview", exact: true })
    .click();
  await page.waitForURL(`${appOrigin}/create?vertical=restaurant`);
  await page
    .getByLabel("Restaurant website or name", { exact: true })
    .waitFor({ state: "visible" });
  await page.screenshot({ path: createPath, fullPage: true });
  return {
    additionalScreenshots: [previewPath, createPath],
    observations: {
      galleryHeading: "The restaurant decides the theme.",
      themeCount,
      selectedTheme: "Terroir Editorial",
      detailUrl,
      previewUrl,
      previewTheme: "terroir-editorial",
      createUrl: page.url(),
      createField: "Restaurant website or name",
    },
  };
}

async function driveFirstCustomer(dryRun: boolean): Promise<JsonRecord> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new CliError("Set DATABASE_URL to an isolated local verification database.");
  }
  assertSafeDatabaseUrl(databaseUrl, true);
  const occupied = [3100, 4100].filter((port) => listenerPids(port).length > 0);
  if (occupied.length > 0) {
    throw new CliError("The first-customer journey requires free ports.", {
      occupiedPorts: occupied,
      remedy: "Run bun scripts/restofront-ctl.ts down --json first.",
    });
  }
  const command = [
    "bunx",
    "playwright",
    "test",
    "tests/e2e/first-customer.pw.ts",
    "--grep",
    "claim, paid webhook, sign-in, workspace selection, private save, atomic publish, and live routing",
  ];
  if (dryRun) {
    return {
      command: "drive",
      feature: "first-customer",
      dryRun: true,
      process: command,
      ports: [3100, 4100],
      database: new URL(databaseUrl).pathname.slice(1),
      externalProviders: "forced to http://127.0.0.1:4100",
    };
  }

  const artifactDirectory = join(artifactRoot, timestampId());
  mkdirSync(artifactDirectory, { recursive: true });
  const child = Bun.spawn(command, {
    cwd: repoRoot,
    env: verificationEnvironment(databaseUrl),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const transcriptPath = join(artifactDirectory, "first-customer.log");
  writeFileSync(transcriptPath, `${stdout}${stderr}`);
  const evidencePath = join(artifactDirectory, "first-customer.json");
  const evidence = {
    schemaVersion: 1,
    feature: "first-customer",
    outcome: exitCode === 0 ? "passed" : "failed",
    exitCode,
    transcript: relative(repoRoot, transcriptPath),
    gitHead: readGitHead(),
    buildId: readBuildId(),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (exitCode !== 0) {
    throw new CliError("The first-customer Playwright journey failed.", {
      exitCode,
      transcript: relative(repoRoot, transcriptPath),
      evidence: relative(repoRoot, evidencePath),
    });
  }
  return {
    command: "drive",
    feature: "first-customer",
    dryRun: false,
    evidence: relative(repoRoot, evidencePath),
    transcript: relative(repoRoot, transcriptPath),
  };
}

function publicDrivePlan(name: Exclude<DriveName, "first-customer">) {
  if (name === "factory-home") {
    return {
      route: "/",
      actions: [
        "Open the factory home.",
        "Follow the Build a local site link.",
        "Enter restaurant.example in Restaurant website or name.",
      ],
      expected: [
        "The browser reaches /create.",
        "Build preview becomes enabled.",
      ],
      skipped: [
        "Submitting Build preview is skipped because source import has no approved local model and fetch double.",
      ],
    };
  }
  return {
    route: "/themes/restaurant",
    actions: [
      "Open the restaurant theme gallery.",
      "Confirm all seven registered theme cards.",
      "Open the first Theme details control.",
      "Open the full Terroir Editorial website preview.",
      "Follow Build a preview to the restaurant intake.",
    ],
    expected: [
      "The browser reaches /themes/restaurant/terroir-editorial.",
      "The Terroir Editorial heading is visible.",
      "The full preview renders data-site-theme=terroir-editorial.",
      "The browser reaches /create?vertical=restaurant.",
    ],
    skipped: [
      "The duplicate gallery Full preview control is skipped after the same preview route is proved from theme detail.",
    ],
  };
}

function startService(input: {
  command: string[];
  expectedCommandText: string;
  logPath: string;
  port: number;
}): ManagedService {
  const log = openSync(input.logPath, "a");
  const child = spawn(input.command[0], input.command.slice(1), {
    cwd: repoRoot,
    detached: true,
    env: verificationEnvironment(process.env.DATABASE_URL),
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  if (!child.pid) throw new CliError(`Could not start service on port ${input.port}.`);
  child.unref();
  return {
    ...input,
    pid: child.pid,
    processGroupId: child.pid,
  };
}

function verificationEnvironment(databaseUrl?: string): NodeJS.ProcessEnv {
  const localDatabase =
    databaseUrl ??
    "postgresql://127.0.0.1:5432/cornershopdev_verify_restofront";
  return {
    ...process.env,
    CORNERSHOP_ENV: "test",
    FIRST_CUSTOMER_E2E: "1",
    NEXT_PUBLIC_APP_URL: appOrigin,
    PLATFORM_HOSTNAMES: "localhost,127.0.0.1",
    PORT: "3100",
    HOSTNAME: "127.0.0.1",
    DATABASE_URL: localDatabase,
    WORKFLOW_POSTGRES_URL: localDatabase,
    REDIS_URL: "redis://127.0.0.1:6379",
    BETTER_AUTH_SECRET: "verify-only-better-auth-secret-32-bytes",
    CLAIM_TOKEN_SECRET: "verify-only-claim-token-secret-32-bytes",
    OUTREACH_LEGAL_CONTROLLER: "Corner Shop Labs Ltd",
    STRIPE_SECRET_KEY: "sk_test_first_customer_e2e",
    STRIPE_WEBHOOK_SECRET: "whsec_first_customer_e2e",
    STRIPE_PRICE_ID: "price_founding_e2e",
    STRIPE_API_BASE_URL: providerOrigin,
    RESEND_API_KEY: "re_test_first_customer_e2e",
    RESEND_API_BASE_URL: providerOrigin,
    EMAIL_FROM: "Cornershopdev Test <test@send.cornershop.example.test>",
    EMAIL_REPLY_TO: "test@reply.cornershop.example.test",
    WORKFLOW_ENABLED: "false",
    WORKFLOW_TARGET_WORLD: "@workflow/world-postgres",
  };
}

function assertSafeDatabaseUrl(value?: string, stateful = false) {
  if (!value) return;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CliError("DATABASE_URL is not a valid URL.");
  }
  if (
    !["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
  ) {
    throw new CliError("Verification refuses a non-local DATABASE_URL.", {
      databaseHost: url.hostname,
    });
  }
  const database = url.pathname.slice(1);
  if (stateful && !/(e2e|test|verify)/i.test(database)) {
    throw new CliError("The stateful journey requires an isolated test database.", {
      database,
      requiredNameFragment: "e2e, test, or verify",
    });
  }
}

function readBuildId(): string {
  try {
    return readFileSync(join(repoRoot, ".next/BUILD_ID"), "utf8").trim();
  } catch {
    throw new CliError("No production build exists.", {
      remedy: "Run the Launch build command from verify-restofront first.",
    });
  }
}

function readGitHead(): string {
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd: repoRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new CliError("Could not read the Git head.");
  return result.stdout.toString().trim();
}

function readState(): RunState | null {
  try {
    const value = JSON.parse(readFileSync(statePath, "utf8")) as RunState;
    if (
      value.schemaVersion !== 1 ||
      value.repoRoot !== repoRoot ||
      !value.services?.app ||
      !value.services?.fakeProviders
    ) {
      throw new Error("state mismatch");
    }
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new CliError("The restofront-ctl state file is invalid.", { statePath });
  }
}

function writeState(state: RunState) {
  mkdirSync(stateDirectory, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

async function inspectState(state: RunState) {
  const currentBuildId = readBuildId();
  const currentGitHead = readGitHead();
  const inspectService = (service: ManagedService): JsonRecord => {
      const processCommand = processCommandText(service.processGroupId);
      const listeners = listenerPids(service.port);
      const listenerGroups = listeners.map((pid) => processGroupId(pid));
      return {
        pid: service.pid,
        processGroupId: service.processGroupId,
        processAlive: processCommand !== null,
        commandMatches: processCommand?.includes(service.expectedCommandText) ?? false,
        port: service.port,
        listenerPids: listeners,
        portOwned: listenerGroups.includes(service.processGroupId),
        logPath: relative(repoRoot, service.logPath),
      };
  };
  const services: Record<ServiceName, JsonRecord> = {
    app: inspectService(state.services.app),
    fakeProviders: inspectService(state.services.fakeProviders),
  };
  const [appHealth, providerHealth] = await Promise.all([
    jsonMatches(`${appOrigin}/api/health/live`, "status", "live"),
    jsonMatches(`${providerOrigin}/_health`, "ok", true),
  ]);
  const buildMatches = currentBuildId === state.buildId;
  const gitHeadMatches = currentGitHead === state.gitHead;
  const serviceChecksPass = Object.values(services).every(
    (service) =>
      service.processAlive === true &&
      service.commandMatches === true &&
      service.portOwned === true,
  );
  return {
    healthy:
      serviceChecksPass && appHealth && providerHealth && buildMatches && gitHeadMatches,
    runId: state.runId,
    buildId: state.buildId,
    currentBuildId,
    buildMatches,
    gitHead: state.gitHead,
    currentGitHead,
    gitHeadMatches,
    appHealth,
    providerHealth,
    services,
    artifactDirectory: state.artifactDirectory,
  };
}

function requireHealthyState(result: JsonRecord) {
  if (result.healthy !== true || typeof result.artifactDirectory !== "string") {
    throw new CliError("Doctor did not return a healthy managed state.");
  }
  return result as JsonRecord & {
    artifactDirectory: string;
    buildId: string;
    gitHead: string;
    runId: string;
  };
}

async function stopState(state: RunState) {
  const stopped = [];
  for (const [name, service] of Object.entries(state.services).reverse()) {
    stopped.push({ name, ...(await stopService(service)) });
  }
  const failures = stopped.filter(
    ({ status }) => status !== "stopped" && status !== "killed" && status !== "already-stopped",
  );
  if (failures.length > 0) {
    throw new CliError("Cleanup refused or failed to stop a recorded process group.", {
      failures,
      statePath,
    });
  }
  rmSync(stateDirectory, { recursive: true, force: true });
  return stopped;
}

async function stopService(service: ManagedService) {
  const command = processCommandText(service.processGroupId);
  if (!command) return { pid: service.pid, status: "already-stopped" };
  if (!command.includes(service.expectedCommandText)) {
    return {
      pid: service.pid,
      status: "refused-command-mismatch",
      observedCommand: command,
    };
  }
  signalProcessGroup(service.processGroupId, "SIGTERM");
  const exited = await waitForExit(service.processGroupId, 5_000);
  if (!exited) {
    signalProcessGroup(service.processGroupId, "SIGKILL");
    const killed = await waitForExit(service.processGroupId, 2_000);
    return {
      pid: service.pid,
      status: killed ? "killed" : "failed-to-stop",
    };
  }
  return { pid: service.pid, status: "stopped" };
}

function signalProcessGroup(processGroupIdValue: number, signal: NodeJS.Signals) {
  try {
    process.kill(-processGroupIdValue, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForExit(processGroupIdValue: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!processCommandText(processGroupIdValue)) return true;
    await Bun.sleep(100);
  }
  return !processCommandText(processGroupIdValue);
}

function listenerPids(port: number): number[] {
  const result = Bun.spawnSync(
    ["lsof", "-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);
}

function processGroupId(pid: number): number | null {
  const result = Bun.spawnSync(["ps", "-o", "pgid=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  const value = Number(result.stdout.toString().trim());
  return Number.isInteger(value) ? value : null;
}

function processCommandText(pid: number): string | null {
  const result = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim() || null;
}

async function waitForJson(
  url: string,
  key: string,
  expected: unknown,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await jsonMatches(url, key, expected)) return;
    await Bun.sleep(250);
  }
  throw new CliError(`Timed out waiting for ${url}.`);
}

async function jsonMatches(url: string, key: string, expected: unknown) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as Record<string, unknown>;
    return body[key] === expected;
  } catch {
    return false;
  }
}

async function visibleHeading(page: Page, name: string) {
  const heading = page.getByRole("heading", { name, exact: true });
  await heading.waitFor({ state: "visible", timeout: 15_000 });
}

function timestampId() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function emit(value: JsonRecord, json: boolean, error = false) {
  const output = json ? JSON.stringify(value, null, 2) : humanOutput(value);
  if (error) console.error(output);
  else console.log(output);
}

function humanOutput(value: JsonRecord) {
  if (value.command === "help" && Array.isArray(value.usage)) {
    return value.usage.join("\n");
  }
  const label = value.ok === false ? "failed" : "ok";
  return `${basename(import.meta.path)} ${String(value.command)}: ${label}\n${JSON.stringify(value, null, 2)}`;
}
