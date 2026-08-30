/**
 * Vertical-agnostic colour maths and contrast repair.
 *
 * Every vertical theme layer shares this module so that WCAG repair is proven
 * once instead of being reimplemented per vertical. Token overrides are a
 * closed vocabulary and repair runs after the merge, so a valid-looking model
 * response cannot produce unreadable body text, surface text or action labels.
 */

export const MIN_TEXT_CONTRAST = 4.5;

function linearChannel(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return (
    0.2126 * linearChannel(red) +
    0.7152 * linearChannel(green) +
    0.0722 * linearChannel(blue)
  );
}

export function colorContrast(left: string, right: string): number {
  const brightest = Math.max(luminance(left), luminance(right));
  const darkest = Math.min(luminance(left), luminance(right));
  return (brightest + 0.05) / (darkest + 0.05);
}

export function accessibleForeground(
  background: string,
  wanted: string,
): string {
  if (colorContrast(background, wanted) >= MIN_TEXT_CONTRAST) return wanted;
  return colorContrast(background, "#ffffff") >=
    colorContrast(background, "#111111")
    ? "#ffffff"
    : "#111111";
}

function channels(hex: string): [number, number, number] {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ];
}

function toHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, "0");
}

/**
 * Moves an accent toward black or white, in hue-preserving steps, until it can
 * carry its own label. `accessibleForeground` only picks the better of two
 * foregrounds, so a mid-tone accent can defeat both; without this pass a valid
 * token override could ship an action button whose text fails AA.
 */
export function readableAccent(accent: string, foreground: string): string {
  if (colorContrast(accent, foreground) >= MIN_TEXT_CONTRAST) return accent;

  const [red, green, blue] = channels(accent);
  const towardBlack = luminance(foreground) > luminance(accent);

  for (let step = 1; step <= 20; step += 1) {
    const ratio = step / 20;
    const shift = (channel: number) =>
      towardBlack ? channel * (1 - ratio) : channel + (255 - channel) * ratio;
    const candidate = `#${toHex(shift(red))}${toHex(shift(green))}${toHex(shift(blue))}`;
    if (colorContrast(candidate, foreground) >= MIN_TEXT_CONTRAST) {
      return candidate;
    }
  }

  return towardBlack ? "#000000" : "#ffffff";
}

/**
 * The five-colour surface every vertical theme publishes. Keeping the shape
 * identical across verticals is what lets one repair pass and one table-driven
 * contrast test cover the whole registry.
 */
export type ThemeColorSurface = {
  background: string;
  foreground: string;
  surface: string;
  accent: string;
  accentForeground: string;
};

/**
 * Repairs body, surface and action contrast in place-safe fashion. A surface
 * that cannot carry the repaired foreground collapses back to the background
 * rather than shipping unreadable text.
 */
export function repairThemeColorSurface<TColors extends ThemeColorSurface>(
  colors: TColors,
): TColors {
  const repaired = { ...colors };

  repaired.foreground = accessibleForeground(
    repaired.background,
    repaired.foreground,
  );
  if (
    colorContrast(repaired.surface, repaired.foreground) < MIN_TEXT_CONTRAST
  ) {
    repaired.surface = repaired.background;
  }
  repaired.accentForeground = accessibleForeground(
    repaired.accent,
    repaired.accentForeground,
  );
  repaired.accent = readableAccent(
    repaired.accent,
    repaired.accentForeground,
  );

  return repaired;
}
