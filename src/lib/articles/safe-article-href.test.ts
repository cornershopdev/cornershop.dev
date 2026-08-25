import { describe, expect, it } from "bun:test";
import {
  approvedArticleDestinations,
  isSafeArticleHref,
} from "@/lib/articles/safe-article-href";

const approved = ["https://www.sevenrooms.com/explore/osteria-luna"];

describe("article markdown href policy", () => {
  it.each(["/menu", "/blog/summer-bread-guide", "/menu?service=dinner", "/#visit"])(
    "allows same-origin path %s",
    (href) => {
      expect(isSafeArticleHref(href, approved)).toBe(true);
    },
  );

  it.each(["#visit", "#menu", "#content"])(
    "allows fragment anchor %s",
    (href) => {
      expect(isSafeArticleHref(href, approved)).toBe(true);
    },
  );

  it("allows an exact published integration destination", () => {
    expect(isSafeArticleHref(approved[0]!, approved)).toBe(true);
  });

  it.each([
    "//attacker.example",
    "//attacker.example/menu",
    "/\\attacker.example/menu",
    "https:\\attacker.example/menu",
    "https://user:pass@sevenrooms.com/explore",
    "https://www.sevenrooms.com:8443/explore",
    "https://exa\u0001mple.com/menu",
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "https://attacker.example/menu",
    "http://www.sevenrooms.com/explore/osteria-luna",
    "https://www.opentable.com/r/other-restaurant",
    "#javascript:alert(1)",
    "#//attacker.example",
    "/javascript:alert(1)",
    "https://www.sevenrooms.com/explore/osteria-luna/extra",
  ])("rejects unsafe href %s", (href) => {
    expect(isSafeArticleHref(href, approved)).toBe(false);
  });

  it("ignores disabled integrations and malformed destinations", () => {
    expect(
      approvedArticleDestinations([
        { enabled: true, url: approved[0]! },
        { enabled: false, url: "https://www.opentable.com/r/hidden" },
        { enabled: true, url: "javascript:alert(1)" },
        { enabled: true, url: "http://insecure.example/order" },
      ]),
    ).toEqual([approved[0]]);
    expect(
      isSafeArticleHref("https://www.opentable.com/r/hidden", [
        "https://www.opentable.com/r/hidden",
      ]),
    ).toBe(true);
    expect(
      isSafeArticleHref(
        "https://www.opentable.com/r/hidden",
        approvedArticleDestinations([
          { enabled: false, url: "https://www.opentable.com/r/hidden" },
        ]),
      ),
    ).toBe(false);
  });
});
