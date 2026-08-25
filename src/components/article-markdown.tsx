import type { ReactNode } from "react";
import { isSafeArticleHref } from "@/lib/articles/safe-article-href";

/**
 * Renders the bounded markdown subset the article generator is prompted to
 * produce: `#`/`##`/`###` headings, paragraphs, `-` lists, and `**bold**` /
 * `*em*` / `[text](href)` inline spans. Deliberately not a general markdown
 * engine — output becomes React nodes instead of HTML, so no generated string
 * can inject markup onto a customer's site. Anything outside the subset
 * renders as plain text.
 */

const HEADING = /^(#{1,3})\s+(.*)$/;
const LIST_ITEM = /^[-*]\s+(.*)$/;

export function ArticleMarkdown({
  markdown,
  approvedDestinations = [],
}: {
  markdown: string;
  approvedDestinations?: readonly string[];
}) {
  return (
    <div className="space-y-4">
      {renderBlocks(markdown, approvedDestinations)}
    </div>
  );
}

function renderBlocks(
  markdown: string,
  approvedDestinations: readonly string[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let key = 0;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join(" ");
    nodes.push(<p key={key++}>{renderInline(text, approvedDestinations)}</p>);
    paragraph = [];
  };
  const flushList = () => {
    if (!listItems.length) return;
    nodes.push(
      <ul key={key++} className="list-disc space-y-1 pl-6">
        {listItems.map((item, index) => (
          <li key={index}>{renderInline(item, approvedDestinations)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = trimmed.match(HEADING);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1]?.length ?? 1;
      const text = heading[2] ?? "";
      if (level === 1)
        nodes.push(
          <h2 key={key++}>{renderInline(text, approvedDestinations)}</h2>,
        );
      else if (level === 2)
        nodes.push(
          <h3 key={key++} className="pt-2">
            {renderInline(text, approvedDestinations)}
          </h3>,
        );
      else
        nodes.push(
          <h4 key={key++} className="pt-2">
            {renderInline(text, approvedDestinations)}
          </h4>,
        );
      continue;
    }
    const item = trimmed.match(LIST_ITEM);
    if (item) {
      flushParagraph();
      listItems.push(item[1] ?? "");
      continue;
    }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  return nodes;
}

const INLINE_PATTERN =
  /\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;

function renderInline(
  text: string,
  approvedDestinations: readonly string[],
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    const [full, bold, em, linkText, href] = match;
    if (bold !== undefined) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (em !== undefined) {
      nodes.push(<em key={key++}>{em}</em>);
    } else if (
      linkText !== undefined &&
      href !== undefined &&
      isSafeArticleHref(href, approvedDestinations)
    ) {
      const isExternal = href.startsWith("https://");
      nodes.push(
        <a
          key={key++}
          href={href}
          className="underline"
          {...(isExternal
            ? { target: "_blank", rel: "noreferrer" }
            : undefined)}
        >
          {linkText}
        </a>,
      );
    } else {
      nodes.push(full);
    }
    lastIndex = index + full.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}
