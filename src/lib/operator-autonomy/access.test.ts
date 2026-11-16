import { describe, expect, it } from "bun:test";
import { operatorMcpAccessProblem } from "@/lib/operator-autonomy/access";

const token = "a".repeat(32);

describe("operator MCP access", () => {
  it("requires a distinct 32-character operator token", () => {
    expect(operatorMcpAccessProblem({})).toBe(
      "OPERATOR_MCP_TOKEN must contain at least 32 characters.",
    );
    expect(
      operatorMcpAccessProblem({ OPERATOR_MCP_TOKEN: "short-token" }),
    ).toBe("OPERATOR_MCP_TOKEN must contain at least 32 characters.");
    expect(
      operatorMcpAccessProblem({
        OPERATOR_MCP_TOKEN: token,
        HEALTHCHECK_TOKEN: token,
      }),
    ).toBe("OPERATOR_MCP_TOKEN must be distinct from HEALTHCHECK_TOKEN.");
    expect(operatorMcpAccessProblem({ OPERATOR_MCP_TOKEN: token })).toBeNull();
  });

  it("refuses to start the stdio server without the token", () => {
    const env = { ...process.env };
    delete env.OPERATOR_MCP_TOKEN;
    const databaseUrl = env.DATABASE_URL;
    const result = Bun.spawnSync(["bun", "scripts/operator-mcp.ts"], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = new TextDecoder().decode(result.stderr);
    const stdout = new TextDecoder().decode(result.stdout);

    expect(result.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("OPERATOR_MCP_TOKEN must contain at least 32 characters.");
    expect(stderr).not.toContain("postgres://");
    if (databaseUrl) expect(stderr).not.toContain(databaseUrl);
  });
});
