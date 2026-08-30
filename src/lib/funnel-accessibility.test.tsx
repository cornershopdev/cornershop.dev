import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ImportStudio } from "@/app/create/import-studio";
import { AuthShell } from "@/app/sign-in/auth-shell";
import { SignInForm } from "@/app/sign-in/sign-in-form";
import { ClaimPanel } from "@/app/claim/[slug]/claim-panel";
import { BookingRequestForm } from "@/components/booking-request-form";
import { Vertical } from "@/generated/prisma/enums";
import { FACTORY_BRAND } from "@/lib/brand";
import { resolveClaimLaunchOffer } from "@/lib/claim-launch-offer";
import { sampleSiteDraft } from "@/lib/restaurant";
import { signInErrorMessage, signInSurface } from "@/lib/sign-in-surface";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";

const importStudioSource = await Bun.file(
  new URL("../app/create/import-studio.tsx", import.meta.url),
).text();
const signInFormSource = await Bun.file(
  new URL("../app/sign-in/sign-in-form.tsx", import.meta.url),
).text();
const authShellSource = await Bun.file(
  new URL("../app/sign-in/auth-shell.tsx", import.meta.url),
).text();
const claimPageSource = await Bun.file(
  new URL("../app/claim/[slug]/page.tsx", import.meta.url),
).text();
const claimPanelSource = await Bun.file(
  new URL("../app/claim/[slug]/claim-panel.tsx", import.meta.url),
).text();
const bookingFormSource = await Bun.file(
  new URL("../components/booking-request-form.tsx", import.meta.url),
).text();

const factoryBrand = {
  ...FACTORY_BRAND,
  vertical: null,
  homeUrl: "https://cornershop.dev",
} as const;

const bookingCopy = {
  name: "Your name",
  email: "Email",
  phone: "Phone",
  when: "Preferred time",
  partySize: "Number of people",
  notes: "Anything we should know?",
  optional: "optional",
  submit: "Send request",
  sending: "Sending…",
  success: "Thanks — we'll be in touch shortly.",
  error: "Your request could not be sent. Try again.",
  previewNotice: "This is a preview — requests are not sent.",
};

describe("create funnel accessibility", () => {
  it("names the Import Studio source field from a visible label, not the placeholder", () => {
    const html = renderToStaticMarkup(
      <ImportStudio
        initialSource=""
        initialVertical={Vertical.RESTAURANT}
        initialBrand={factoryBrand}
      />,
    );

    const source = associatedControl(html, "Restaurant website or name", "input");
    expect(source.id).toBe("import-source");
    expect(attribute(source.attributes, "placeholder")).toBe(
      "restaurant.com or restaurant name",
    );
    expect(attribute(source.attributes, "placeholder")).not.toBe(
      "Restaurant website or name",
    );
    expect(html).toContain('type="submit"');
    expect(html).toContain("Build preview");
    expect(html).toContain('aria-label="Back to Cornershopdev"');
    expect(html).toContain('aria-label="Mobile preview"');
    expect(html).toContain('aria-label="Desktop preview"');
    expect(html).toContain('aria-label="Kind of business"');
  });

  it("keeps Beauty source copy non-chargeable while still naming the control", () => {
    const html = renderToStaticMarkup(
      <ImportStudio
        initialSource=""
        initialVertical={Vertical.BEAUTY}
        initialBrand={factoryBrand}
      />,
    );

    const source = associatedControl(html, "Salon website or name", "input");
    expect(attribute(source.attributes, "placeholder")).toBe(
      "salon.com or salon name",
    );
    expect(html).toContain("The preview stays private and is not chargeable.");
    expect(html).not.toContain("€49");
    expect(html).not.toContain("founding plan");
  });

  it("announces import progress and asynchronous errors, and keeps busy names", () => {
    expect(importStudioSource).toContain('role="status"');
    expect(importStudioSource).toContain('aria-live="polite"');
    expect(importStudioSource).toContain('role="alert"');
    expect(importStudioSource).toContain('id="import-source-error"');
    expect(importStudioSource).toContain("aria-busy={loading}");
    expect(importStudioSource).toContain("Finishing the details");
    expect(importStudioSource).toContain("Build preview");
    expect(importStudioSource).toContain("<form");
    expect(importStudioSource).toContain('type="submit"');
    expect(importStudioSource).toContain('<Field');
    expect(importStudioSource).toContain('label={copy.sourceLabel}');
  });
});

describe("sign-in funnel accessibility", () => {
  it("names the email field, associates help, and announces initial errors", () => {
    const surface = signInSurface(null);
    const error = signInErrorMessage("INVALID_TOKEN");
    const html = renderToStaticMarkup(
      <AuthShell surface={surface} backHref="/">
        <SignInForm copy={surface.copy} inverse={surface.inverse} initialError={error} />
      </AuthShell>,
    );

    const email = associatedControl(html, "Email", "input");
    expect(email.id).toBe("sign-in-email");
    expect(attribute(email.attributes, "placeholder")).toBe("you@business.com");
    expect(attribute(email.attributes, "placeholder")).not.toBe("Email");
    expect(attribute(email.attributes, "aria-invalid")).toBe("true");
    expect(attribute(email.attributes, "aria-describedby")).toBe(
      "sign-in-email-error",
    );
    expect(html).toContain('id="sign-in-email-error"');
    expect(html).toContain('role="alert"');
    expect(html).toContain(error!);
    expect(html).toContain("Email me a secure link");
    expect(html).toContain('type="submit"');
    expect(html).toContain('aria-label="Back to Cornershopdev"');
  });

  it("keeps restaurant placeholders as examples on the same Email name", () => {
    const surface = signInSurface(restaurantMarketing);
    const html = renderToStaticMarkup(
      <SignInForm
        copy={surface.copy}
        inverse={surface.inverse}
        initialError={null}
      />,
    );

    const email = associatedControl(html, "Email", "input");
    expect(attribute(email.attributes, "placeholder")).toBe(
      "owner@restaurant.com",
    );
    expect(html).not.toContain('role="alert"');
  });

  it("announces sent state, moves focus, and keeps a meaningful busy name", () => {
    expect(signInFormSource).toContain("headingRef.current?.focus()");
    expect(signInFormSource).toContain("tabIndex={sent ? -1 : undefined}");
    expect(signInFormSource).toContain('role={sent ? "status" : undefined}');
    expect(signInFormSource).toContain("aria-busy={loading}");
    expect(signInFormSource).toContain("Email me a secure link");
    expect(signInFormSource).toContain("<form onSubmit={submit}");
    expect(signInFormSource).toContain('type="submit"');
    expect(authShellSource).toContain("aria-label={`Back to ${surface.brand.name}`}");
  });
});

describe("claim funnel accessibility", () => {
  it("names the owner email field and keeps the founding example as a placeholder", () => {
    const offer = resolveClaimLaunchOffer(restaurantMarketing);
    expect(offer).not.toBeNull();
    const html = renderToStaticMarkup(
      <ClaimPanel
        slug={sampleSiteDraft.slug}
        vertical={Vertical.RESTAURANT}
        fallbackDraft={sampleSiteDraft}
        offer={offer}
        checkoutReturn={null}
      />,
    );

    const email = associatedControl(html, "Business owner email", "input");
    expect(email.id).toBe("claim-email");
    expect(attribute(email.attributes, "placeholder")).toBe(
      "owner@restaurant.com",
    );
    expect(html).toContain(`id="${email.id}-description"`);
    expect(html).toContain("Verify ownership by email");
    expect(html).toContain('type="submit"');
    expect(html).toContain("€49");
  });

  it("announces checkout processing through a live status region", () => {
    const offer = resolveClaimLaunchOffer(restaurantMarketing);
    const html = renderToStaticMarkup(
      <ClaimPanel
        slug={sampleSiteDraft.slug}
        vertical={Vertical.RESTAURANT}
        fallbackDraft={sampleSiteDraft}
        offer={offer}
        checkoutReturn={{
          sessionId: "cs_test_123",
          claimInvitationId: "claim_123",
        }}
      />,
    );

    expect(html).toContain("Payment received. Finalizing the owner account");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain("Sending ownership link");
    expect(html).toContain('aria-busy="true"');
  });

  it("gives the claim back icon a name and announces invitation, errors, and busy names", () => {
    expect(claimPageSource).toContain('aria-label="Back to create"');
    expect(claimPanelSource).toContain('role="alert"');
    expect(claimPanelSource).toContain('role="status"');
    expect(claimPanelSource).toContain('aria-live="polite"');
    expect(claimPanelSource).toContain("aria-busy={loading}");
    expect(claimPanelSource).toContain("Sending ownership link");
    expect(claimPanelSource).toContain("Opening secure checkout");
    expect(claimPanelSource).toContain("Verify ownership by email");
    expect(claimPanelSource).toContain("<form onSubmit={submit}");
    expect(claimPanelSource).toContain('type="submit"');
  });
});

describe("booking funnel accessibility", () => {
  it("names every booking control from a persistent label", () => {
    const html = renderToStaticMarkup(
      <BookingRequestForm slug="osteria-luna" copy={bookingCopy} />,
    );

    expect(associatedControl(html, "Your name", "input").id).toBe(
      "booking-request-name",
    );
    expect(associatedControl(html, "Email", "input").id).toBe(
      "booking-request-email",
    );
    expect(associatedControl(html, "Phone", "input").id).toBe(
      "booking-request-phone",
    );
    expect(associatedControl(html, "Preferred time", "input").id).toBe(
      "booking-request-when",
    );
    expect(associatedControl(html, "Number of people", "input").id).toBe(
      "booking-request-party-size",
    );
    expect(html).toContain('for="booking-request-notes"');
    expect(html).toContain('id="booking-request-notes"');
    expect(html).toContain("Anything we should know?");
    expect(html).toContain("Send request");
    expect(html).toContain('type="submit"');
    expect(html).not.toContain('role="alert"');
  });

  it("associates asynchronous errors and announces success with a focus move", () => {
    expect(bookingFormSource).toContain('id={errorId}');
    expect(bookingFormSource).toContain('role="alert"');
    expect(bookingFormSource).toContain('aria-describedby={error ? errorId : undefined}');
    expect(bookingFormSource).toContain('role="status"');
    expect(bookingFormSource).toContain('aria-live="polite"');
    expect(bookingFormSource).toContain("tabIndex={-1}");
    expect(bookingFormSource).toContain("successRef.current?.focus()");
    expect(bookingFormSource).toContain("aria-busy={sending}");
    expect(bookingFormSource).toContain("{sending ? copy.sending : copy.submit}");
    expect(bookingFormSource).toContain("<form");
    expect(bookingFormSource).toContain('type="submit"');
  });
});

function associatedControl(
  html: string,
  label: string,
  tag: "input" | "select" | "textarea",
) {
  const labelMatch = html.match(
    new RegExp(
      `<label\\b[^>]*\\bfor="([^"]+)"[^>]*>${escapeRegex(label)}</label>`,
    ),
  );
  expect(labelMatch, `Expected a visible label named “${label}”`).not.toBeNull();
  const id = labelMatch![1];
  const control = html.match(
    new RegExp(`<${tag}\\b(?=[^>]*\\bid="${escapeRegex(id)}")[^>]*>`),
  );
  expect(
    control,
    `Expected ${tag}#${id} to be associated with “${label}”`,
  ).not.toBeNull();
  return { id, attributes: control![0] };
}

function attribute(attributes: string, name: string) {
  return attributes.match(
    new RegExp(`(?:^|\\s)${escapeRegex(name)}="([^"]*)"`),
  )?.[1];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
