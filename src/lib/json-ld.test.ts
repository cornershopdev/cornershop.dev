import { describe, expect, it } from "bun:test";
import { serializeJsonLd } from "@/lib/json-ld";

describe("JSON-LD serialization", () => {
  it("escapes script openings and JavaScript line separators without changing values", () => {
    const value = {
      headline: "</script><script>alert(1)</script>",
      description: "before\u2028middle\u2029after",
    };

    const serialized = serializeJsonLd(value);

    expect(serialized).not.toContain("<");
    expect(serialized).not.toContain("\u2028");
    expect(serialized).not.toContain("\u2029");
    expect(serialized).toContain("\\u003c/script>");
    expect(serialized).toContain("\\u2028");
    expect(serialized).toContain("\\u2029");
    expect(JSON.parse(serialized)).toEqual(value);
  });
});
