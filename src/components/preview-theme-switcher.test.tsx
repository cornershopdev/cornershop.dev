import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PreviewThemeSwitcher } from "@/components/preview-theme-switcher";
import type { PreviewThemeOption } from "@/lib/preview-theme-alternates";

const options: PreviewThemeOption[] = [
  {
    id: "after-dark",
    name: "After Dark",
    description: "Low-light dining room",
    active: true,
  },
  {
    id: "vesper-room",
    name: "Vesper Room",
    description: "Cocktail-forward evening service",
    active: false,
  },
  {
    id: "terroir-editorial",
    name: "Terroir Editorial",
    description: "Producer-led tasting menu",
    active: false,
  },
];

const reasons = ["Fits the full service model", "Keeps reserve as the primary action"];

function render(input: Partial<Parameters<typeof PreviewThemeSwitcher>[0]> = {}) {
  return renderToStaticMarkup(
    <PreviewThemeSwitcher
      basePath="/preview/osteria-luna"
      options={options}
      reasons={reasons}
      {...input}
    />,
  );
}

describe("preview theme switcher", () => {
  it("links every shortlisted theme back through the preview path", () => {
    const html = render();

    for (const option of options) {
      expect(html).toContain(
        `href="/preview/osteria-luna?theme=${option.id}"`,
      );
      expect(html).toContain(option.name);
      expect(html).toContain(option.description);
    }
  });

  it("marks the active option for assistive technology", () => {
    const html = render();

    expect(html).toContain('aria-current="true"');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Preview theme alternates"');
  });

  it("shows the selection reasons only while the recorded theme is on screen", () => {
    expect(render()).toContain(reasons.join(" · "));

    const alternateActive = options.map((option, index) => ({
      ...option,
      active: index === 1,
    }));
    expect(render({ options: alternateActive })).not.toContain(reasons[0]);
  });

  it("renders nothing when there is no alternative to offer", () => {
    expect(render({ options: [] })).toBe("");
    expect(render({ options: [options[0]] })).toBe("");
  });

  it("stays out of print output and above the rendered site", () => {
    const html = render();

    expect(html).toContain("print:hidden");
    expect(html).toContain("fixed");
    expect(html).toContain("z-50");
  });
});
