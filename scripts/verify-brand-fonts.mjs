import process from "node:process";
import puppeteer from "puppeteer-core";
import { browserPath } from "./browser-path.mjs";

const port = Number(process.env.BRAND_FONT_AUDIT_PORT ?? 4174);
const origin = `http://127.0.0.1:${port}`;
// Linux and macOS rasterize fallback glyph baselines differently even when the
// containing blocks and line counts are identical. Keep this sentinel 10x
// stricter than the production CLS budget while allowing that platform noise.
const maxFontSwapLayoutShift = 0.01;

const audits = [
  {
    name: "Cornershop factory",
    path: "/",
    preloadCount: 2,
    requestCount: 2,
    fonts: [
      { selector: "h1", family: "Geist" },
      { selector: ".font-mono", family: "Geist Mono" },
    ],
    drawer: { family: "Geist" },
  },
  {
    name: "Restofront",
    path: "/niche/restaurant",
    preloadCount: 2,
    requestCount: 2,
    fonts: [
      { selector: "h1", family: "Instrument Serif" },
      { selector: "main p", family: "Geist" },
      { selector: ".font-mono", family: "Geist" },
    ],
    drawer: { family: "Geist" },
  },
  {
    name: "Terroir customer theme",
    path: "/themes/restaurant/terroir-editorial",
    preloadCount: 3,
    requestCount: 3,
    fonts: [
      { selector: "h1", family: "Instrument Serif" },
      { selector: ".font-mono", family: "Geist Mono" },
    ],
  },
  {
    name: "Authentication shell",
    path: "/sign-in",
    preloadCount: 2,
    requestCount: 2,
    fonts: [
      { selector: "h1", family: "Geist" },
      { selector: "form button", family: "Geist" },
    ],
  },
];

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The standalone server is still starting.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Standalone server did not become ready at ${origin}`);
}

async function platformFonts(session, selector) {
  const { root } = await session.send("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const { nodeId } = await session.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector,
  });
  if (!nodeId) throw new Error(`Missing font audit selector: ${selector}`);
  const { fonts } = await session.send("CSS.getPlatformFontsForNode", {
    nodeId,
  });
  return fonts;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function assertPhysicalFont(session, selector, expectedFamily, surface) {
  const fonts = await platformFonts(session, selector);
  const match = fonts.find(
    (font) =>
      font.isCustomFont &&
      font.familyName.toLowerCase().includes(expectedFamily.toLowerCase()),
  );
  assert(
    match,
    `${surface} ${selector} used ${fonts
      .map((font) => `${font.familyName} (${font.isCustomFont ? "custom" : "system"})`)
      .join(", ")} instead of ${expectedFamily}`,
  );
}

async function auditSurface(browser, audit) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const session = await page.createCDPSession();
  const fontRequests = [];
  let firstContentfulPaint;

  await Promise.all([
    session.send("DOM.enable"),
    session.send("CSS.enable"),
    session.send("Page.enable"),
    session.send("Page.setLifecycleEventsEnabled", { enabled: true }),
    session.send("Network.enable"),
    session.send("Performance.enable"),
    session.send("Network.setCacheDisabled", { cacheDisabled: true }),
    session.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1638.4 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    }),
    session.send("Emulation.setCPUThrottlingRate", { rate: 4 }),
  ]);
  session.on("Network.requestWillBeSent", (event) => {
    if (event.type === "Font") {
      fontRequests.push({
        url: event.request.url,
        timestamp: event.timestamp,
        initiator: event.initiator,
      });
    }
  });
  session.on("Page.lifecycleEvent", (event) => {
    if (event.name === "firstContentfulPaint") {
      firstContentfulPaint = event.timestamp;
    }
  });
  await page.evaluateOnNewDocument(() => {
    window.__brandFontLayoutShifts = [];
    window.__brandFontEvents = [];
    document.fonts.addEventListener("loadingdone", (event) => {
      window.__brandFontEvents.push({
        at: performance.now(),
        families: event.fontfaces.map((face) => face.family),
      });
    });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__brandFontLayoutShifts.push({
          at: entry.startTime,
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          sources: entry.sources.map(({ node, previousRect, currentRect }) => ({
            node:
              node instanceof Element
                ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${[...node.classList].slice(0, 3).join(".")}`
                : node?.parentElement
                  ? `text in ${node.parentElement.tagName.toLowerCase()}${node.parentElement.id ? `#${node.parentElement.id}` : ""}.${[...node.parentElement.classList].slice(0, 3).join(".")}`
                  : "unknown",
            previousRect: {
              x: previousRect.x,
              y: previousRect.y,
              width: previousRect.width,
              height: previousRect.height,
            },
            currentRect: {
              x: currentRect.x,
              y: currentRect.y,
              width: currentRect.width,
              height: currentRect.height,
            },
          })),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });

  const response = await page.goto(`${origin}${audit.path}`, {
    waitUntil: "domcontentloaded",
  });
  const documentPreloads = await page.$$eval(
    'link[rel="preload"][as="font"]',
    (links) => links.map((link) => link.href),
  );
  const headerPreloads = (response?.headers().link ?? "")
    .split(",")
    .map((part) => part.match(/<([^>]+)>;\s*rel=preload;\s*as="font"/)?.[1])
    .filter(Boolean)
    .map((url) => new URL(url, origin).href);
  const preloadLinks = [...new Set([...documentPreloads, ...headerPreloads])];
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => resolve())),
  );
  const initialRects = await page.evaluate(
    (fonts) =>
      fonts.map(({ selector }) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        const range = document.createRange();
        if (element) range.selectNodeContents(element);
        const lineCount = element
          ? new Set(
              [...range.getClientRects()].map((line) =>
                Math.round(line.top * 1000),
              ),
            ).size
          : undefined;
        return rect
          ? {
              selector,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left,
              lineCount,
            }
          : { selector };
      }),
    audit.fonts,
  );
  await page.evaluate(() => document.fonts.ready);
  await page.waitForNetworkIdle();
  const finalRects = await page.evaluate(
    (fonts) =>
      fonts.map(({ selector }) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        const range = document.createRange();
        if (element) range.selectNodeContents(element);
        const lineCount = element
          ? new Set(
              [...range.getClientRects()].map((line) =>
                Math.round(line.top * 1000),
              ),
            ).size
          : undefined;
        return rect
          ? {
              selector,
              width: rect.width,
              height: rect.height,
              top: rect.top,
              left: rect.left,
              lineCount,
            }
          : { selector };
      }),
    audit.fonts,
  );

  const stableGeometry = finalRects.every((finalRect, index) => {
    const initialRect = initialRects[index];
    return (
      finalRect.selector === initialRect.selector &&
      finalRect.lineCount === initialRect.lineCount &&
      ["width", "height", "top", "left"].every(
        (key) => finalRect[key] === initialRect[key],
      )
    );
  });
  assert(
    stableGeometry,
    `${audit.name} changed audited font geometry: ${JSON.stringify({ initialRects, finalRects })}`,
  );

  assert(
    preloadLinks.length === audit.preloadCount,
    `${audit.name} preloaded ${preloadLinks.length} fonts, expected ${audit.preloadCount}: ${preloadLinks.join(", ")}`,
  );
  assert(
    fontRequests.length === audit.requestCount,
    `${audit.name} requested ${fontRequests.length} fonts, expected ${audit.requestCount}: ${JSON.stringify(fontRequests)}`,
  );

  assert(firstContentfulPaint, `${audit.name} did not record first contentful paint`);
  const preloadRequests = fontRequests.filter(({ url }) =>
    preloadLinks.includes(url),
  );
  assert(
    preloadRequests.length === preloadLinks.length,
    `${audit.name} did not request every declared font preload`,
  );
  for (const request of preloadRequests) {
    assert(
      request.timestamp <= firstContentfulPaint,
      `${audit.name} started ${request.url} after first contentful paint`,
    );
  }

  for (const font of audit.fonts) {
    await assertPhysicalFont(session, font.selector, font.family, audit.name);
  }

  const layoutShifts = await page.evaluate(() =>
    window.__brandFontLayoutShifts.filter((entry) => !entry.hadRecentInput),
  );
  const cumulativeLayoutShift = layoutShifts.reduce(
    (total, entry) => total + entry.value,
    0,
  );
  assert(
    cumulativeLayoutShift <= maxFontSwapLayoutShift,
    `${audit.name} shifted by ${cumulativeLayoutShift}: ${JSON.stringify({ initialRects, finalRects, layoutShifts, fontEvents: await page.evaluate(() => window.__brandFontEvents) })}`,
  );

  if (audit.drawer) {
    await page.click('[aria-label="Open navigation"]');
    await page.waitForSelector('[data-slot="sheet-content"]', { visible: true });
    await assertPhysicalFont(
      session,
      '[data-slot="sheet-title"] a',
      audit.drawer.family,
      `${audit.name} drawer`,
    );
  }

  console.log(
    `${audit.name}: ${preloadLinks.length} route preloads, ${fontRequests.length} font requests, CLS ${cumulativeLayoutShift}`,
  );
  await context.close();
}

await Bun.$`bun run lighthouse:assemble`.quiet();
const server = Bun.spawn(["node", ".next/standalone/server.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
    PLATFORM_HOSTNAMES: "127.0.0.1",
    WORKFLOW_TARGET_WORLD: "local",
    BETTER_AUTH_SECRET:
      process.env.BETTER_AUTH_SECRET ?? "ci-only-better-auth-secret-32-bytes",
    DATABASE_URL:
      process.env.DATABASE_URL ??
      "postgresql://ci:ci@127.0.0.1:5432/cornershopdev_ci",
  },
  stdout: "inherit",
  stderr: "inherit",
});

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: browserPath(),
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  for (const audit of audits) await auditSurface(browser, audit);
} finally {
  await browser?.close();
  server.kill();
  await server.exited;
}
