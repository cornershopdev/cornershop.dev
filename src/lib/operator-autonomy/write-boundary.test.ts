import { describe, expect, it } from "bun:test";
import { FORBIDDEN_OPERATOR_ACTIONS } from "@/lib/operator-autonomy/contract";

const root = new URL(".", import.meta.url);
const files = [
  "access.ts",
  "brief.ts",
  "contract.ts",
  "mcp.ts",
  "redact.ts",
  "snapshot.ts",
  "types.ts",
];

describe("operator autonomy write boundary", () => {
  it("keeps the module on reads and leaves forbidden actions unregistered", async () => {
    const mcp = await Bun.file(new URL("mcp.ts", root)).text();
    for (const action of FORBIDDEN_OPERATOR_ACTIONS) {
      expect(mcp).not.toContain(`"${action}"`);
      expect(mcp).not.toContain(`'${action}'`);
    }

    for (const file of files) {
      const source = await Bun.file(new URL(file, root)).text();
      expect(source).not.toMatch(
        /\b(?:db|transaction|tx)\.[A-Za-z]+\.(?:create|update|updateMany|delete|deleteMany|upsert)\(/,
      );
      expect(source).not.toMatch(/\$executeRaw|\$executeRawUnsafe|\$transaction\s*\(/);
      expect(source).not.toMatch(
        /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|GRANT|REVOKE)\b/,
      );
    }
  });
});
