import { describe, expect, it } from "bun:test";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FadeIn,
  KenBurns,
  MOTION_PRESETS,
  MOTION_STAGGER_CLASS,
  motionClassName,
  motionProps,
  motionStyle,
  Reveal,
  RiseIn,
  ScaleIn,
  Sheen,
  Stagger,
  type MotionPreset,
} from "@/components/motion";

const appDir = path.resolve(import.meta.dir, "../../app");
const motionCss = await Bun.file(path.join(appDir, "motion.css")).text();
const globalsCss = await Bun.file(path.join(appDir, "globals.css")).text();

/** Extracts a balanced at-rule body so assertions cannot leak past its brace. */
function atRuleBody(css: string, prelude: string): string {
  const start = css.indexOf(prelude);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  if (open === -1) return "";
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  return "";
}

const reducedMotionBlock = atRuleBody(
  motionCss,
  "@media (prefers-reduced-motion: reduce)",
);
const viewTimelineBlock = atRuleBody(
  motionCss,
  "@supports (animation-timeline: view())",
);

const presetComponents: Record<
  MotionPreset,
  (props: { children?: React.ReactNode }) => React.JSX.Element
> = {
  "fade-in": FadeIn,
  "rise-in": RiseIn,
  "scale-in": ScaleIn,
  reveal: Reveal,
  "ken-burns": KenBurns,
  sheen: Sheen,
};

describe("motion stylesheet contract", () => {
  it("ships every registered preset as a global utility", () => {
    for (const preset of MOTION_PRESETS) {
      expect(motionCss).toContain(`.${motionClassName(preset)} {`);
    }
  });

  it("is loaded by the global stylesheet", () => {
    expect(globalsCss).toContain('@import "./motion.css";');
  });

  it("declares keyframes for every animation it references", () => {
    const referenced = new Set(
      [...motionCss.matchAll(/animation:\s*(motion-[a-z-]+)/g)].map(
        (match) => match[1],
      ),
    );
    expect(referenced.size).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(motionCss).toContain(`@keyframes ${name} {`);
    }
  });
});

describe("reduced motion contract", () => {
  it("neutralises animation inside the reduced-motion block", () => {
    expect(reducedMotionBlock).not.toBe("");
    expect(reducedMotionBlock).toContain("animation: none;");
  });

  /*
   * Table-driven on purpose: a new preset that forgets its reduced-motion path
   * fails here rather than shipping vestibular-triggering motion to a visitor
   * who explicitly asked the platform not to animate.
   */
  for (const preset of MOTION_PRESETS) {
    it(`honours prefers-reduced-motion for ${preset}`, () => {
      expect(reducedMotionBlock).toContain(`.${motionClassName(preset)}`);
    });
  }

  it("flattens the stagger cascade under reduced motion", () => {
    expect(reducedMotionBlock).toContain(`.${MOTION_STAGGER_CLASS} > *`);
    expect(reducedMotionBlock).toContain("--motion-delay: 0ms;");
  });
});

describe("scroll reveal degradation", () => {
  it("keeps revealed content visible without scroll-driven timeline support", () => {
    const base = motionCss.slice(
      motionCss.indexOf(".motion-reveal {"),
      motionCss.indexOf("@supports (animation-timeline: view())"),
    );
    expect(base).toContain("opacity: 1;");
    expect(base).not.toContain("animation:");
  });

  it("only animates the reveal behind the support guard", () => {
    expect(viewTimelineBlock).toContain("animation-timeline: view();");
    expect(viewTimelineBlock).toContain("animation-range:");
  });
});

describe("motion style tokens", () => {
  it("emits only the custom properties it was given", () => {
    expect(motionStyle({ preset: "rise-in" })).toEqual({});
    expect(motionStyle({ preset: "rise-in", delayMs: 120 })).toEqual({
      "--motion-delay": "120ms",
    } as unknown as React.CSSProperties);
  });

  it("clamps hostile timing values", () => {
    const style = motionStyle({
      preset: "rise-in",
      delayMs: -500,
      durationMs: 10_000_000,
      distancePx: 5_000,
      scaleFrom: 0,
    }) as unknown as Record<string, string>;
    expect(style["--motion-delay"]).toBe("0ms");
    expect(style["--motion-duration"]).toBe("40000ms");
    expect(style["--motion-distance"]).toBe("160px");
    expect(style["--motion-scale-from"]).toBe("0.5");
  });

  it("drops non-finite values instead of emitting invalid CSS", () => {
    const style = motionStyle({
      preset: "fade-in",
      delayMs: Number.NaN,
      durationMs: Number.POSITIVE_INFINITY,
    }) as unknown as Record<string, string>;
    expect(style["--motion-delay"]).toBeUndefined();
    expect(style["--motion-duration"]).toBeUndefined();
  });

  it("merges caller classes and lets caller styles win", () => {
    const props = motionProps({
      preset: "scale-in",
      delayMs: 60,
      className: "grid gap-4",
      style: { "--motion-delay": "999ms" } as React.CSSProperties,
    });
    expect(props.className).toContain("motion-scale-in");
    expect(props.className).toContain("grid gap-4");
    expect(
      (props.style as unknown as Record<string, string>)["--motion-delay"],
    ).toBe("999ms");
  });
});

describe("motion components", () => {
  for (const preset of MOTION_PRESETS) {
    it(`renders ${preset} statically with its utility class`, () => {
      const Component = presetComponents[preset];
      const markup = renderToStaticMarkup(<Component>copy</Component>);
      expect(markup).toContain(motionClassName(preset));
      expect(markup).toContain("copy");
    });
  }

  it("renders the stagger container with its step token", () => {
    const markup = renderToStaticMarkup(
      <Stagger stepMs={140} className="grid">
        <RiseIn>one</RiseIn>
        <RiseIn>two</RiseIn>
      </Stagger>,
    );
    expect(markup).toContain(MOTION_STAGGER_CLASS);
    expect(markup).toContain("--motion-stagger-step:140ms");
    expect(markup).toContain("one");
    expect(markup).toContain("two");
  });

  it("clamps the stagger step", () => {
    const markup = renderToStaticMarkup(<Stagger stepMs={-40}>child</Stagger>);
    expect(markup).toContain("--motion-stagger-step:0ms");
  });
});
