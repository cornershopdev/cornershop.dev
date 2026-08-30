import Link from "next/link";
import {
  PREVIEW_THEME_PARAM,
  type PreviewThemeOption,
} from "@/lib/preview-theme-alternates";

/**
 * Factory-only preview chrome. It offers the shortlist the recorded selection
 * already named, never the whole registry, and it is fixed rather than in flow
 * so it cannot alter the layout a customer is being asked to judge.
 *
 * Callers must not render this on the live customer surface.
 */
export function PreviewThemeSwitcher({
  basePath,
  options,
  reasons,
}: {
  basePath: string;
  options: PreviewThemeOption[];
  reasons: string[];
}) {
  if (options.length < 2) return null;
  // Reasons explain the recorded theme, so they stay hidden while an
  // alternate is on screen rather than being restated for a theme they were
  // never written about.
  const recordedActive = options[0]?.active ?? false;

  return (
    <nav
      aria-label="Preview theme alternates"
      className="fixed inset-x-0 bottom-0 z-50 flex justify-center p-3 print:hidden"
    >
      <div className="pointer-events-auto flex max-w-full flex-col gap-2 rounded-2xl border border-white/15 bg-[#181818]/95 px-4 py-3 text-white shadow-lg backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/60">
            View as
          </span>
          {options.map((option) => (
            <Link
              key={option.id}
              href={`${basePath}?${PREVIEW_THEME_PARAM}=${option.id}`}
              aria-current={option.active ? "true" : undefined}
              title={option.description}
              className={
                option.active
                  ? "rounded-full bg-white px-3 py-1.5 text-sm font-medium text-black"
                  : "rounded-full border border-white/25 px-3 py-1.5 text-sm text-white/85 hover:border-white/50 hover:text-white"
              }
            >
              {option.name}
            </Link>
          ))}
        </div>
        {recordedActive && reasons.length > 0 ? (
          <p className="max-w-prose text-xs text-white/60">
            {reasons.join(" · ")}
          </p>
        ) : null}
      </div>
    </nav>
  );
}
