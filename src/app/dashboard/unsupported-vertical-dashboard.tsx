import Link from "next/link";
import { Brand } from "@/components/brand";
import { AccountActions } from "@/components/account-actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { BrandIdentity } from "@/lib/brand";
import type { Vertical } from "@/generated/prisma/enums";

/**
 * Restaurant owns the full editor today. Verticals without a dedicated
 * owner-review dashboard can still import a private preview, but must not
 * fall through to the restaurant sample draft under the real slug.
 */
export function UnsupportedVerticalDashboard({
  email,
  slug,
  vertical,
  brand,
}: {
  email: string;
  slug: string;
  vertical: Vertical;
  brand: BrandIdentity;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-4">
          <Brand {...brand} />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
            <AccountActions canSwitch />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <Card>
          <CardHeader>
            <CardTitle>Owner tools for this vertical are next</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">{slug}</span> is a{" "}
              <span className="font-medium text-foreground">
                {vertical.toLowerCase()}
              </span>{" "}
              site. This is a private, non-chargeable preview. The dashboard
              editor still ships restaurant-first so we do not risk rewriting
              your content as a restaurant sample.
            </p>
            <p>
              Open the private preview to inspect the generated site, or switch
              workspace if you manage a restaurant as well.
            </p>
            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={`/preview/${encodeURIComponent(slug)}`}
                className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground"
              >
                Open preview
              </Link>
              <Link
                href="/workspace/select"
                className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm font-medium"
              >
                Switch workspace
              </Link>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
