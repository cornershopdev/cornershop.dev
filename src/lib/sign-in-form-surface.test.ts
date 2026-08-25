import { describe, expect, it } from "bun:test";

const signInForm = await Bun.file(
  new URL("../app/sign-in/sign-in-form.tsx", import.meta.url),
).text();
const verifyPage = await Bun.file(
  new URL("../app/sign-in/verify/page.tsx", import.meta.url),
).text();
const verifyRoute = await Bun.file(
  new URL("../app/api/auth/verify/route.ts", import.meta.url),
).text();

describe("magic-link sign-in form surface", () => {
  it("submits through the form handler instead of rendering a non-submit button", () => {
    expect(signInForm).toContain("<form onSubmit={submit}");
    expect(signInForm).toContain('type="submit"');
  });

  it("names the email field and announces asynchronous errors", () => {
    expect(signInForm).toContain('<Field label="Email" controlId="sign-in-email"');
    expect(signInForm).toContain("error={error}");
    expect(signInForm).toContain('placeholder={copy.emailPlaceholder}');
    expect(signInForm).toContain("aria-busy={loading}");
    expect(signInForm).toContain("Email me a secure link");
  });

  it("preserves token privacy while allowing the same-origin verification form", () => {
    expect(verifyRoute).toContain(
      'response.headers.set("Referrer-Policy", "no-referrer")',
    );
    expect(verifyPage).toContain('referrer: "no-referrer"');
    expect(verifyPage).toContain(
      '<form action="/api/auth/verify" method="post"',
    );
    expect(verifyPage).toContain('<Button type="submit"');
  });
});
