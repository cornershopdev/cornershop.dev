import { describe, expect, it } from "bun:test";

const dockerfile = await Bun.file(
  new URL("../../Dockerfile", import.meta.url),
).text();
const entrypoint = await Bun.file(
  new URL("../../deploy/aws/container-entrypoint.sh", import.meta.url),
).text();
const packageJson = await Bun.file(
  new URL("../../package.json", import.meta.url),
).text();
const runtimeContract = await Bun.file(
  new URL("../../deploy/aws/test-container-runtime.sh", import.meta.url),
).text();
const workflow = await Bun.file(
  new URL("../../.github/workflows/ci.yml", import.meta.url),
).text();

describe("production container runtime", () => {
  it("serves Next standalone with pinned Node while retaining pinned Bun tools", () => {
    expect(dockerfile).toContain(
      "FROM node:24.20.0-alpine3.24 AS node-toolchain",
    );
    expect(dockerfile).toContain("FROM node-toolchain AS dependencies");
    expect(dockerfile).toContain("FROM node-toolchain AS runner");
    const patchCopy = dockerfile.indexOf("COPY patches ./patches");
    const frozenInstall = dockerfile.indexOf(
      "RUN bun install --frozen-lockfile",
    );
    expect(patchCopy).toBeGreaterThan(
      dockerfile.indexOf("COPY package.json bun.lock ./"),
    );
    expect(patchCopy).toBeLessThan(frozenInstall);
    expect(dockerfile).toContain(
      "COPY --from=bun-source /usr/local/bin/bun /usr/local/bin/bun",
    );
    expect(dockerfile).toContain(
      "ln -s /usr/local/bin/bun /usr/local/bin/bunx",
    );
    expect(dockerfile).toContain("USER node");
    expect(entrypoint).toContain("bun run db:migrate:deploy");
    expect(entrypoint).toContain("bun run workflow:migrate");
    expect(entrypoint).toContain("exec node server.js");
    expect(entrypoint).not.toContain("exec bun server.js");
    expect(packageJson).toContain("node node_modules/next/dist/bin/next build");
    expect(packageJson).not.toContain('&& next build"');
    expect(dockerfile).toContain(
      'RUN node --input-type=module -e \'import sharp from "sharp";',
    );
    expect(dockerfile).toContain("sharp(encoded).resize(1, 1).toBuffer()");
    expect(dockerfile).not.toContain("RUN bun -e 'import sharp");
    expect(dockerfile).toContain(
      "--outfile=.operator-scripts/dispatch-inbound-forwards.ts",
    );
  });

  it("boots and exercises the candidate image in CI", () => {
    expect(workflow).toContain("container-runtime:");
    expect(workflow).toContain(
      "docker build --tag cornershopdev:runtime-contract .",
    );
    expect(workflow).toContain(
      "bash deploy/aws/test-container-runtime.sh cornershopdev:runtime-contract",
    );
    expect(runtimeContract).toContain("readlink /proc/1/exe");
    expect(runtimeContract).toContain("command -v node");
    expect(runtimeContract).toContain("Expected PID 1 executable");
    expect(runtimeContract).toContain(
      "test -f /app/scripts/dispatch-inbound-forwards.ts",
    );
    expect(runtimeContract).toContain(
      "bun run operator:dispatch-inbound-forwards",
    );
    expect(runtimeContract).toContain('assert_status "/" "200"');
    expect(runtimeContract).toContain(
      'assert_status "/niche/restaurant" "200"',
    );
    expect(runtimeContract).toContain('assert_status "/niche/beauty" "200"');
    expect(runtimeContract).toContain(
      'assert_status "/niche/food_retail" "404"',
    );
    expect(runtimeContract).toContain('assert_status "/sign-in" "200"');
    expect(runtimeContract).toContain(
      'assert_status "/api/auth/get-session" "200"',
    );
    expect(runtimeContract).toContain('assert_status "/dashboard" "307"');
  });
});
