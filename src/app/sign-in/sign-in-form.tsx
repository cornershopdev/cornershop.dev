"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, LoaderCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { SignInCopy } from "@/lib/sign-in-surface";
import { cn } from "@/lib/utils";

export function SignInForm({
  copy,
  inverse,
  initialError,
}: {
  copy: SignInCopy;
  inverse: boolean;
  initialError: string | null;
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!sent) return;
    headingRef.current?.focus();
  }, [sent]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not send link");
      setSent(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send link");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      className={cn(
        "w-full max-w-md border bg-card p-7",
        inverse
          ? "rounded-2xl shadow-[0_28px_80px_rgb(0_0_0/0.56)]"
          : "rounded-3xl shadow-xl",
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-primary/10 text-primary">
        {sent ? <Check className="size-5" /> : <Mail className="size-5" />}
      </span>
      <h1
        ref={headingRef}
        tabIndex={sent ? -1 : undefined}
        className={cn(
          "mt-5 leading-none tracking-[-0.045em]",
          inverse
            ? "text-4xl font-semibold"
            : "font-display text-5xl",
        )}
      >
        {sent ? "Check your inbox." : copy.title}
      </h1>
      <p
        className="mt-4 text-sm leading-6 text-muted-foreground"
        role={sent ? "status" : undefined}
        aria-live={sent ? "polite" : undefined}
      >
        {sent
          ? `If an account exists for ${email}, a secure sign-in link should arrive shortly.`
          : copy.description}
      </p>
      {!sent ? (
        <form onSubmit={submit} className="mt-7 space-y-3" aria-busy={loading}>
          <Field label="Email" controlId="sign-in-email" error={error}>
            <Input
              type="email"
              name="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={copy.emailPlaceholder}
              className="h-11"
              required
            />
          </Field>
          <Button
            type="submit"
            className="h-11 w-full"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : null}
            Email me a secure link
            {!loading ? <ArrowRight /> : null}
          </Button>
        </form>
      ) : null}
      <div className="mt-6 border-t pt-5 text-center text-xs text-muted-foreground">
        {copy.emptyPrompt}{" "}
        <Link
          href={copy.createHref}
          prefetch={false}
          className="font-semibold text-foreground"
        >
          {copy.createLabel}
        </Link>
      </div>
    </section>
  );
}
