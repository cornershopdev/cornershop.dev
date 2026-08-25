import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ArticleMarkdown } from "@/components/article-markdown";

const approved = ["https://www.sevenrooms.com/explore/osteria-luna"];

describe("article markdown rendering", () => {
  it("keeps safe same-origin paths, anchors, and approved destinations as links", () => {
    const markup = renderToStaticMarkup(
      <ArticleMarkdown
        markdown={[
          "See the [menu](/menu) or [visit](#visit).",
          `Book via [SevenRooms](${approved[0]}).`,
        ].join("\n\n")}
        approvedDestinations={approved}
      />,
    );

    expect(markup).toContain('href="/menu"');
    expect(markup).toContain('href="#visit"');
    expect(markup).toContain(`href="${approved[0]}"`);
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).not.toContain("data-analytics-cta");
  });

  it.each([
    ["protocol-relative", "[x](//attacker.example)"],
    ["backslash", "[x](/\\attacker.example)"],
    ["credentialed", "[x](https://user:pass@sevenrooms.com/explore)"],
    ["control character", "[x](https://exa\u0001mple.com)"],
    ["unsupported external", "[x](https://attacker.example/menu)"],
  ])("renders %s destinations as text", (_label, markdown) => {
    const markup = renderToStaticMarkup(
      <ArticleMarkdown markdown={markdown} approvedDestinations={approved} />,
    );
    expect(markup).not.toContain("<a ");
    expect(markup).toContain(markdown);
  });
});
