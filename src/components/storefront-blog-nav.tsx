import { cn } from "@/lib/utils";

/**
 * One shared Blog entry for live renderer themes. The href is only present when
 * the attested published version has articles; preview and unpublished
 * surfaces pass a null href or `isLiveSurface={false}` and render nothing.
 */
export function StorefrontBlogNav({
  href,
  label,
  isLiveSurface = false,
  className,
}: {
  href?: string | null;
  label: string;
  isLiveSurface?: boolean;
  className?: string;
}) {
  if (!isLiveSurface || !href) return null;
  return (
    <a
      href={href}
      data-storefront-nav="blog"
      className={cn(
        "inline-flex min-h-11 items-center text-sm font-semibold opacity-80 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
    >
      {label}
    </a>
  );
}
