import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The registered motion vocabulary. Adding a preset here without adding it to
 * the `prefers-reduced-motion: reduce` block in `src/app/motion.css` fails
 * `motion.test.tsx` — reduced motion is a contract, not a convention.
 */
export const MOTION_PRESETS = [
  "fade-in",
  "rise-in",
  "scale-in",
  "reveal",
  "ken-burns",
  "sheen",
] as const;

export type MotionPreset = (typeof MOTION_PRESETS)[number];

export const MOTION_STAGGER_CLASS = "motion-stagger";

/**
 * Bounds exist because theme tokens and, eventually, owner-facing controls feed
 * these numbers. A theme cannot ask for a twelve second entrance that leaves a
 * customer looking at an empty hero, and it cannot ask for a negative delay.
 */
const DELAY_BOUNDS = { min: 0, max: 4_000 } as const;
const DURATION_BOUNDS = { min: 80, max: 40_000 } as const;
const DISTANCE_BOUNDS = { min: 0, max: 160 } as const;
const SCALE_BOUNDS = { min: 0.5, max: 1.6 } as const;
const STEP_BOUNDS = { min: 0, max: 600 } as const;

function clamp(
  value: number | undefined,
  bounds: { min: number; max: number },
): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

export type MotionOptions = {
  preset: MotionPreset;
  /** Start offset in milliseconds. */
  delayMs?: number;
  /** Animation length in milliseconds. */
  durationMs?: number;
  /** Travel distance for `rise-in` and `reveal`, in pixels. */
  distancePx?: number;
  /** Starting scale for `scale-in`. */
  scaleFrom?: number;
  /** Target scale for `ken-burns`. */
  scaleTo?: number;
};

export function motionClassName(preset: MotionPreset): string {
  return `motion-${preset}`;
}

/**
 * Custom properties rather than generated classes: the same six presets cover
 * every vertical, and a theme differentiates itself by timing and distance.
 */
export function motionStyle(options: MotionOptions): CSSProperties {
  const variables: Record<string, string> = {};
  const delay = clamp(options.delayMs, DELAY_BOUNDS);
  if (delay !== null) variables["--motion-delay"] = `${delay}ms`;
  const duration = clamp(options.durationMs, DURATION_BOUNDS);
  if (duration !== null) variables["--motion-duration"] = `${duration}ms`;
  const distance = clamp(options.distancePx, DISTANCE_BOUNDS);
  if (distance !== null) variables["--motion-distance"] = `${distance}px`;
  const scaleFrom = clamp(options.scaleFrom, SCALE_BOUNDS);
  if (scaleFrom !== null) variables["--motion-scale-from"] = `${scaleFrom}`;
  const scaleTo = clamp(options.scaleTo, SCALE_BOUNDS);
  if (scaleTo !== null) variables["--motion-scale-to"] = `${scaleTo}`;
  return variables as CSSProperties;
}

/**
 * Spread onto any element a renderer already owns, so motion can be added
 * without wrapping markup in another div and disturbing grid or flex layout.
 */
export function motionProps(
  options: MotionOptions & { className?: string; style?: CSSProperties },
): { className: string; style: CSSProperties } {
  return {
    className: cn(motionClassName(options.preset), options.className),
    style: { ...motionStyle(options), ...options.style },
  };
}

type MotionBlockProps = Omit<MotionOptions, "preset"> & {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
};

function motionBlock(preset: MotionPreset) {
  return function MotionBlock({
    children,
    className,
    style,
    ...options
  }: MotionBlockProps) {
    return (
      <div {...motionProps({ preset, className, style, ...options })}>
        {children}
      </div>
    );
  };
}

/** Opacity only. The safest entrance for dense text blocks. */
export const FadeIn = motionBlock("fade-in");

/** Opacity plus upward travel. The default entrance for section headers. */
export const RiseIn = motionBlock("rise-in");

/** Opacity plus scale. Reserved for cards and imagery, not body copy. */
export const ScaleIn = motionBlock("scale-in");

/**
 * Scroll-driven entrance. Zero JavaScript: browsers without
 * `animation-timeline: view()` render the content statically and visibly.
 */
export const Reveal = motionBlock("reveal");

/** Slow drift for hero imagery. Requires an `overflow: hidden` parent. */
export const KenBurns = motionBlock("ken-burns");

/** Hairline sweep for loading and generating surfaces. */
export const Sheen = motionBlock("sheen");

export type StaggerProps = {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Delay added per child, in milliseconds. */
  stepMs?: number;
};

/**
 * Cascades its direct children by handing each one an index-derived
 * `--motion-delay`. Children still choose their own preset, so a grid can rise
 * while a sidebar fades on the same cascade.
 */
export function Stagger({ children, className, style, stepMs }: StaggerProps) {
  const step = clamp(stepMs, STEP_BOUNDS);
  const variables: Record<string, string> = {};
  if (step !== null) variables["--motion-stagger-step"] = `${step}ms`;
  return (
    <div
      className={cn(MOTION_STAGGER_CLASS, className)}
      style={{ ...(variables as CSSProperties), ...style }}
    >
      {children}
    </div>
  );
}
