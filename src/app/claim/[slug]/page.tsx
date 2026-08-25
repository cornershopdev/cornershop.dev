import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Brand } from "@/components/brand";
import { ClaimPanel } from "@/app/claim/[slug]/claim-panel";
import { Button } from "@/components/ui/button";
import { claimPageState } from "@/lib/claim-launch-offer";
import { findSiteView } from "@/lib/sites";

type ClaimPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{
    checkout?: string;
    session_id?: string;
    claim_id?: string;
  }>;
};

// The site's own vertical, not the Host header, decides the brand here too:
// an owner can reach their claim link from anywhere.
export async function generateMetadata({
  params,
}: ClaimPageProps): Promise<Metadata> {
  const { slug } = await params;
  const state = claimPageState(await findSiteView(slug));
  if (state.kind === "not_found") notFound();
  return {
    title: { absolute: `Claim your ${state.brand.name} site` },
    robots: { index: false, follow: false },
  };
}

export default async function ClaimPage({
  params,
  searchParams,
}: ClaimPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const state = claimPageState(await findSiteView(slug));
  if (state.kind === "not_found") notFound();

  return (
    <main className="min-h-screen">
      <header className="flex h-16 items-center gap-4 border-b px-5">
        <Button
          render={<Link href="/create" aria-label="Back to create" />}
          nativeButton={false}
          variant="ghost"
          size="icon-sm"
        >
          <ArrowLeft />
        </Button>
        <Brand {...state.brand} />
      </header>
      <ClaimPanel
        slug={slug}
        vertical={state.vertical}
        fallbackDraft={state.draft}
        offer={state.offer}
        checkoutReturn={
          query.checkout === "processing" && query.session_id && query.claim_id
            ? {
                sessionId: query.session_id,
                claimInvitationId: query.claim_id,
              }
            : null
        }
      />
    </main>
  );
}
