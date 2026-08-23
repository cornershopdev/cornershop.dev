import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { e2e } from "./support/fixtures";

test("food-retail factory preview issues ownership and starts the one-plan checkout", async ({
  page,
  request,
}) => {
  const claimPage = await page.goto(`/claim/${e2e.foodSlug}`);
  expect(claimPage?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: e2e.foodName, exact: true }),
  ).toBeVisible();

  const invitation = await request.post("/api/claim-invitations", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: { siteSlug: e2e.foodSlug, email: e2e.foodOwnerEmail },
  });
  expect(invitation.status()).toBe(200);
  const claimLink = await latestMailboxLink(request, e2e.foodOwnerEmail);
  const invitationToken = new URL(claimLink).hash.replace(/^#claim_token=/, "");

  const checkout = await request.post("/api/checkout", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      plan: "founding",
      siteSlug: e2e.foodSlug,
      invitationToken,
    },
  });
  expect(checkout.status()).toBe(200);
  expect(await checkout.json()).toMatchObject({
    url: expect.stringMatching(
      /^http:\/\/127\.0\.0\.1:4100\/checkout\/cs_test_/,
    ),
  });

  const replacedToken = await request.post("/api/checkout", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: {
      plan: "founding",
      siteSlug: e2e.foodSlug,
      invitationToken: e2e.foodSupersededInvitationToken,
    },
  });
  expect(replacedToken.status()).toBe(403);
});

test("claim, paid webhook, sign-in, workspace selection, private save, atomic publish, and live routing", async ({
  page,
  request,
  context,
}) => {
  const initialSite = inspectDatabase();
  const originalIntegrationDigest = initialSite.integrationDigest;

  await page.goto(`/claim/${e2e.targetSlug}`);
  await page.getByPlaceholder("owner@restaurant.com").fill(e2e.ownerEmail);
  await page.getByRole("button", { name: "Verify ownership by email" }).click();
  await expect(page.getByText("Check that inbox")).toBeVisible();
  const claimLink = await latestMailboxLink(request, e2e.ownerEmail);
  const claimToken = new URL(claimLink).hash.replace(/^#claim_token=/, "");

  await page.goto(claimLink);
  await expect(
    page.getByText("One-time ownership link attached"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Claim and continue" }).click();
  await expect(page).toHaveURL(/127\.0\.0\.1:4100\/checkout\/cs_test_/);
  await expect(
    page.getByText("€43.00 local presentment for the $49 monthly plan"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pay €43 in test mode" }).click();

  await expect(page).toHaveURL(/\/workspace\/select$/);
  await expect(page.getByText(e2e.targetName)).toBeVisible();
  await expect(page.getByText(e2e.existingName)).toBeVisible();
  await expect(page.getByText(e2e.unauthorizedName)).not.toBeVisible();
  expect(await currentSessionBinding(page)).toMatchObject({
    purpose: "WORKSPACE_SELECTION",
    siteId: null,
  });
  expect(await selectWorkspace(page, e2e.unauthorizedId)).toBe(403);
  await page.getByRole("button", { name: `Open ${e2e.targetName}` }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  expect(await currentSessionBinding(page)).toMatchObject({
    purpose: "SITE",
    siteId: e2e.targetId,
  });
  await expect(
    page.getByRole("heading", { name: `Welcome to ${e2e.targetName}.` }),
  ).toBeVisible();

  const replay = await request.post("/api/checkout", {
    headers: {
      Origin: "http://127.0.0.1:3100",
      "Content-Type": "application/json",
    },
    data: {
      plan: "founding",
      siteSlug: e2e.targetSlug,
      invitationToken: claimToken,
    },
  });
  expect(replay.status()).toBe(409);

  const logout = await page.evaluate(async () =>
    fetch("/api/auth/logout", { method: "POST" }).then(
      (response) => response.status,
    ),
  );
  expect(logout).toBe(200);
  await page.goto("/sign-in");
  await page.locator('input[type="email"]').fill(e2e.ownerEmail);
  await page.getByRole("button", { name: "Email me a secure link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox." }),
  ).toBeVisible();
  const signInLink = await latestMailboxLink(
    request,
    e2e.ownerEmail,
    claimLink,
  );
  await page.goto(signInLink);
  await expect(
    page.getByRole("heading", { name: "Confirm it's you." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue securely" }).click();
  await expect(page).toHaveURL(/\/workspace\/select$/);
  await expect(page.getByText(e2e.targetName)).toBeVisible();
  await expect(page.getByText(e2e.existingName)).toBeVisible();
  expect(await selectWorkspace(page, e2e.unauthorizedId)).toBe(403);
  const selectionCookies = await context.cookies();
  await page.getByRole("button", { name: `Open ${e2e.targetName}` }).click();
  await expect(page).toHaveURL(/\/dashboard/);

  const staleSession = await playwrightRequest.newContext({
    baseURL: "http://127.0.0.1:3100",
    extraHTTPHeaders: {
      Cookie: selectionCookies
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; "),
    },
  });
  const staleDashboard = await staleSession.get("/dashboard", {
    maxRedirects: 0,
  });
  expect(staleDashboard.status()).toBeGreaterThanOrEqual(300);
  expect(staleDashboard.headers().location).not.toContain("/dashboard");
  await staleSession.dispose();

  const beforePublish = await request.get("http://127.0.0.1:3100/", {
    headers: { Host: `${e2e.targetSlug}.restofront.com` },
    maxRedirects: 0,
  });
  expect(beforePublish.status()).toBe(404);

  const staleEditor = await context.newPage();
  await staleEditor.goto("/dashboard");
  const staleSettingsTab = staleEditor.getByRole("tab", { name: "Settings" });
  await staleSettingsTab.click();
  await expect(staleSettingsTab).toHaveAttribute("aria-selected", "true");
  const staleRestaurantName = staleEditor.getByLabel("Restaurant name", {
    exact: true,
  });
  await expect(staleRestaurantName).toHaveValue(e2e.targetName);

  const settingsTab = page.getByRole("tab", { name: "Settings" });
  await settingsTab.click();
  await expect(settingsTab).toHaveAttribute("aria-selected", "true");
  await expect(settingsTab).toHaveAttribute("aria-controls", /.+/);
  const restaurantName = page.getByLabel("Restaurant name", { exact: true });
  await expect(restaurantName).toBeVisible();
  await restaurantName.fill(e2e.editedName);
  const firstSaveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sites/${e2e.targetSlug}`) &&
      response.request().method() === "PUT",
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const firstSaveResponse = await firstSaveResponsePromise;
  expect(firstSaveResponse.status()).toBe(200);
  expect(firstSaveResponse.request().postDataJSON()).toMatchObject({
    expectedRevision: initialSite.draftRevision,
  });
  const firstSave = (await firstSaveResponse.json()) as { revision: number };
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }),
  ).toBeVisible();

  await staleRestaurantName.fill(`${e2e.editedName} stale`);
  const staleSaveResponsePromise = staleEditor.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sites/${e2e.targetSlug}`) &&
      response.request().method() === "PUT",
  );
  await staleEditor.getByRole("button", { name: "Save", exact: true }).click();
  const staleSaveResponse = await staleSaveResponsePromise;
  expect(staleSaveResponse.request().postDataJSON()).toMatchObject({
    expectedRevision: initialSite.draftRevision,
  });
  expect(staleSaveResponse.status()).toBe(409);
  expect(await staleSaveResponse.json()).toMatchObject({
    code: "DRAFT_REVISION_CONFLICT",
    currentRevision: firstSave.revision,
  });
  await expect(
    staleEditor
      .getByText(
        "This draft was updated elsewhere. Reload before saving again.",
      )
      .first(),
  ).toBeVisible();
  await staleEditor.close();

  const afterPrivateSave = await request.get("http://127.0.0.1:3100/", {
    headers: { Host: `${e2e.targetSlug}.restofront.com` },
    maxRedirects: 0,
  });
  expect(afterPrivateSave.status()).toBe(404);

  page.on("dialog", async (dialog) => {
    await dialog.accept(
      dialog.type() === "prompt"
        ? "Publish browser-tested owner edit"
        : undefined,
    );
  });
  const publishSaveResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sites/${e2e.targetSlug}`) &&
      response.request().method() === "PUT",
  );
  const publishResponsePromise = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/sites/${e2e.targetSlug}/publish`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const publishSaveResponse = await publishSaveResponsePromise;
  expect(publishSaveResponse.status()).toBe(200);
  const publishSave = (await publishSaveResponse.json()) as {
    revision: number;
  };
  const publishResponse = await publishResponsePromise;
  expect(publishResponse.status()).toBe(200);
  expect(publishResponse.request().postDataJSON()).toMatchObject({
    expectedRevision: publishSave.revision,
  });
  await expect(
    page.getByRole("button", { name: "Published v1" }),
  ).toBeVisible();

  const live = await request.get("http://127.0.0.1:3100/", {
    headers: { Host: `${e2e.targetSlug}.restofront.com` },
  });
  expect(live.status()).toBe(200);
  expect(await live.text()).toContain(e2e.editedName);
  expect(live.headers()["x-cornershop-site-version"]).toBeTruthy();

  const site = inspectDatabase();
  expect(site.integrationDigest).toBe(originalIntegrationDigest);
  expect(site.status).toBe("CLAIMED");
  expect(site.publishedSiteVersionId).not.toBeNull();
  expect(site.publishedSiteVersionId).toBe(
    live.headers()["x-cornershop-site-version"],
  );
  expect(site.invitationAccepted).toBe(true);
  expect(site.auditTypes).toEqual([
    "site.draft.saved",
    "site.draft.saved",
    "site.published",
  ]);

  expect(
    await page.evaluate(async () =>
      fetch("/api/auth/logout", { method: "POST" }).then(
        (response) => response.status,
      ),
    ),
  ).toBe(200);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});

function inspectDatabase(): {
  draftRevision: number;
  status: string;
  publishedSiteVersionId: string | null;
  invitationAccepted: boolean;
  auditTypes: string[];
  integrationDigest: string;
} {
  return JSON.parse(
    execFileSync("bun", ["tests/e2e/support/database.ts", "inspect"], {
      env: process.env,
      encoding: "utf8",
    }),
  );
}

async function latestMailboxLink(
  request: APIRequestContext,
  email: string,
  previous?: string,
): Promise<string> {
  await expect
    .poll(async () => {
      const response = await request.get(
        `http://127.0.0.1:4100/_mailbox/latest?to=${encodeURIComponent(email)}`,
      );
      if (!response.ok()) return null;
      const payload = (await response.json()) as { html?: string };
      const link = payload.html
        ?.match(/href="([^"]+)"/)?.[1]
        ?.replaceAll("&amp;", "&");
      return link && link !== previous ? link : null;
    })
    .not.toBeNull();
  const response = await request.get(
    `http://127.0.0.1:4100/_mailbox/latest?to=${encodeURIComponent(email)}`,
  );
  const payload = (await response.json()) as { html: string };
  const link = payload.html
    .match(/href="([^"]+)"/)?.[1]
    ?.replaceAll("&amp;", "&");
  if (!link || link === previous) throw new Error("Mailbox link unavailable");
  return link;
}

async function selectWorkspace(
  page: import("@playwright/test").Page,
  siteId: string,
): Promise<number> {
  return page.evaluate(async (selectedSiteId) => {
    const response = await fetch("/api/auth/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId: selectedSiteId }),
    });
    return response.status;
  }, siteId);
}

async function currentSessionBinding(
  page: import("@playwright/test").Page,
): Promise<{ purpose?: string; siteId?: string | null }> {
  return page.evaluate(async () => {
    const response = await fetch("/api/auth/get-session");
    if (!response.ok) throw new Error("Session lookup failed");
    const payload = (await response.json()) as {
      session?: { purpose?: string; siteId?: string | null };
    };
    return payload.session ?? {};
  });
}
