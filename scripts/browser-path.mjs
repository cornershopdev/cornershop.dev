import { existsSync } from "node:fs";

export function browserPath() {
  const candidates = [
    process.env.BROWSER_PATH,
    process.env.CHROME_PATH,
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const executable = candidates.find((candidate) => existsSync(candidate));
  if (!executable) {
    throw new Error(
      "No supported browser found. Set BROWSER_PATH to Brave or Chrome.",
    );
  }
  return executable;
}
