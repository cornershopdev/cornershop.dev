"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { SiteRenderer } from "@/components/site-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ClaimPanelProps } from "@/lib/claim-launch-offer";

export function ClaimPanel({
  slug,
  vertical,
  fallbackDraft,
  checkoutReturn,
  offer,
}: ClaimPanelProps) {
  const draft = fallbackDraft;
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(Boolean(checkoutReturn));
  const [invitationSent, setInvitationSent] = useState(false);
  const [invitationToken, setInvitationToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let revealToken: number | undefined;

    function consumeClaimFragment() {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("claim_token");
      if (token && /^[A-Za-z0-9_-]{32,128}$/.test(token)) {
        if (revealToken !== undefined) window.clearTimeout(revealToken);
        revealToken = window.setTimeout(() => setInvitationToken(token), 0);
      }
      if (window.location.hash) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    }

    consumeClaimFragment();
    window.addEventListener("hashchange", consumeClaimFragment);
    return () => {
      window.removeEventListener("hashchange", consumeClaimFragment);
      if (revealToken !== undefined) window.clearTimeout(revealToken);
    };
  }, []);

  useEffect(() => {
    if (!checkoutReturn) return;
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    async function reconcile() {
      const params = new URLSearchParams({
        session_id: checkoutReturn!.sessionId,
        claim_id: checkoutReturn!.claimInvitationId,
        poll: "1",
      });
      try {
        const response = await fetch(`/api/auth/checkout?${params}`, {
          cache: "no-store",
        });
        const result = (await response.json()) as {
          ready?: boolean;
          url?: string;
          error?: string;
        };
        if (response.ok && result.ready && result.url) {
          window.location.assign(result.url);
          return;
        }
        if (!response.ok && response.status !== 202) {
          throw new Error(result.error ?? "Account provisioning failed");
        }
      } catch (caught) {
        if (!stopped) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Account provisioning failed",
          );
        }
        return;
      }
      attempt += 1;
      if (!stopped && attempt < 10) {
        retryTimer = window.setTimeout(
          () => void reconcile(),
          Math.min(1_000 * attempt, 3_000),
        );
      } else if (!stopped) {
        setError(
          "Payment succeeded, but the account is still being finalized. Refresh in a moment.",
        );
      }
    }

    void reconcile();
    return () => {
      stopped = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [checkoutReturn]);

  async function requestInvitation() {
    if (!email) return;
    setLoading(true);
    setInvitationSent(false);
    setError(null);
    try {
      const response = await fetch("/api/claim-invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteSlug: slug, email }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: string;
      };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Ownership verification could not be sent");
      }
      setInvitationSent(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Ownership verification could not be sent",
      );
    } finally {
      setLoading(false);
    }
  }

  async function checkout() {
    if (!invitationToken || !offer) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan: offer.planId,
          siteSlug: slug,
          invitationToken,
        }),
      });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? "Checkout could not start");
      }
      window.location.assign(result.url);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Checkout could not start",
      );
      setLoading(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!offer || loading || (!invitationToken && !email)) return;
    void (invitationToken ? checkout() : requestInvitation());
  }

  const errorSummaryId = "claim-error-summary";

  return (
    <div className="grid lg:grid-cols-[1fr_0.9fr]">
      <section className="bg-[#ece8de] p-4 sm:p-8 lg:min-h-[calc(100vh-4rem)] lg:p-10">
        <div className="mx-auto max-w-[700px]">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Private preview
              </p>
              <h1 className="font-display mt-1 text-4xl tracking-[-0.04em]">
                Claim {draft.name}
              </h1>
            </div>
            <Button
              render={
                <Link href={`/preview/${slug}`} target="_blank" />
              }
              variant="outline"
              size="sm"
            >
              Full preview <ExternalLink />
            </Button>
          </div>
          <div className="max-h-[690px] overflow-hidden rounded-[1.75rem] border-[7px] border-[#171914] bg-white p-1 shadow-2xl">
            <div className="origin-top scale-[0.72]">
              <div className="w-[138.89%]">
                <SiteRenderer draft={draft} vertical={vertical} embedded />
              </div>
            </div>
          </div>
        </div>
      </section>

      <aside className="flex items-center px-5 py-12 sm:px-10 lg:px-14">
        <div className="mx-auto w-full max-w-xl">
          <Badge variant="secondary" className="rounded-full">
            <ShieldCheck />
            {invitationToken
              ? "One-time ownership link attached"
              : "Ownership proof required before payment"}
          </Badge>
          <h2 className="font-display text-balance mt-5 text-5xl leading-[0.92] tracking-[-0.045em]">
            Keep this site current.
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Claiming creates the owner account and unlocks editing. The current
            website and domain stay untouched until the final DNS step.
          </p>
          {checkoutReturn ? (
            <p className="mt-4 rounded-xl border bg-muted/45 px-4 py-3 text-xs leading-5">
              Payment received. Finalizing the owner account from Stripe&apos;s
              signed webhook…
            </p>
          ) : null}

          {offer ? (
            <div className="mt-8">
              <div className="rounded-2xl border border-primary bg-primary/5 p-5 ring-2 ring-primary/12">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{offer.name}</span>
                      {offer.badge ? (
                        <Badge className="text-[10px]">{offer.badge}</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {offer.copy}
                    </p>
                  </div>
                  <span className="font-display text-4xl">
                    {offer.price}
                    <small className="font-sans text-xs text-muted-foreground">
                      {offer.cadence}
                    </small>
                  </span>
                </div>
                <div className="mt-4 grid gap-2 sm:grid-cols-2">
                  {offer.features.map((feature) => (
                    <span
                      key={feature}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Check className="size-3 text-primary" /> {feature}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : checkoutReturn ? null : (
            <div
              className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/5 p-5"
              role="status"
            >
              <p className="text-sm font-medium">
                Claiming is unavailable for {draft.name}.
              </p>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                The launch offer for this site is not configured, so checkout
                cannot start. Ask the operator who sent this preview to try
                again once the offer is available.
              </p>
            </div>
          )}

          {offer ? (
            <form onSubmit={submit} className="mt-7">
              {invitationToken ? (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <p className="text-sm font-medium">Ownership link ready</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Checkout will verify that this one-time link belongs to this
                    site and the email approved for it.
                  </p>
                </div>
              ) : (
                <Field
                  label="Business owner email"
                  controlId="claim-email"
                  description="Use the email shown on the source website or an address on that exact domain. Concierge-approved owners can use the address the operator approved."
                >
                  <Input
                    type="email"
                    name="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setInvitationSent(false);
                    }}
                    placeholder={offer.emailPlaceholder}
                    className="h-11"
                    aria-invalid={error && !invitationToken ? true : undefined}
                    aria-describedby={
                      error ? errorSummaryId : undefined
                    }
                  />
                </Field>
              )}
              {invitationSent ? (
                <p
                  className="mt-3 rounded-lg bg-primary/8 px-3 py-2 text-xs text-primary"
                  role="status"
                >
                  Check that inbox for the 48-hour one-time ownership link.
                </p>
              ) : null}
              {error ? (
                <p
                  id={errorSummaryId}
                  className="mt-3 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <Button
                type="submit"
                size="lg"
                className="mt-4 h-12 w-full"
                disabled={(!invitationToken && !email) || loading}
              >
                {loading ? (
                  <>
                    <LoaderCircle className="animate-spin" />
                    {invitationToken
                      ? "Opening secure checkout"
                      : "Sending ownership link"}
                  </>
                ) : invitationToken ? (
                  <>
                    Claim and continue <ArrowRight />
                  </>
                ) : (
                  <>
                    Verify ownership by email <ArrowRight />
                  </>
                )}
              </Button>
              <p className="mt-3 text-center text-[11px] leading-5 text-muted-foreground">
                {invitationToken
                  ? "Secure subscription checkout by Stripe. The invitation is accepted only after checkout completes."
                  : "No checkout or owner account can start until the approved email opens its one-time link."}
              </p>
            </form>
          ) : error ? (
            <p
              id={errorSummaryId}
              className="mt-3 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
