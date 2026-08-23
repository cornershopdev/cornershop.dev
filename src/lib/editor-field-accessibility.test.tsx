import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

import { FoodRetailDashboard } from "@/app/dashboard/food-retail-dashboard";
import { LocalServiceDashboard } from "@/app/dashboard/local-service-dashboard";
import { RestaurantIntegrationEditor } from "@/components/restaurant-integration-editor";
import { RestaurantMenuEditor } from "@/components/restaurant-menu-editor";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { FACTORY_BRAND } from "@/lib/brand";
import { sampleRestaurant } from "@/lib/restaurant";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

const restaurantIntegrationEditorSource = await Bun.file(
  new URL("../components/restaurant-integration-editor.tsx", import.meta.url),
).text();

describe("shared editor field", () => {
  it("generates unique, stable control IDs for repeated visible labels", () => {
    const render = () =>
      renderToStaticMarkup(
        <>
          <Field label="Description">
            <Input defaultValue="Corner Shop" />
          </Field>
          <Field label="Description">
            <Textarea defaultValue="Neighbourhood essentials" />
          </Field>
        </>,
      );

    const first = render();
    const second = render();
    const firstIds = associatedControlIds(first, "Description");
    const secondIds = associatedControlIds(second, "Description");

    expect(firstIds).toHaveLength(2);
    expect(new Set(firstIds).size).toBe(2);
    expect(firstIds).toEqual(secondIds);
    controlById(first, firstIds[0], "input");
    controlById(first, firstIds[1], "textarea");
  });

  it("preserves caller IDs and composes help and error associations", () => {
    const html = renderToStaticMarkup(
      <>
        <Field label="Currency">
          <select id="menu-currency" defaultValue="EUR">
            <option>EUR</option>
          </select>
        </Field>
        <Field
          label="Contact email"
          controlId="contact-email"
          description="Used for order questions."
          error="Enter a valid email."
        >
          <Input
            type="email"
            aria-describedby="account-help"
            disabled
          />
        </Field>
      </>,
    );

    expect(associatedControl(html, "Currency", "select").id).toBe(
      "menu-currency",
    );
    const email = associatedControl(html, "Contact email", "input");
    expect(email.id).toBe("contact-email");
    expect(attribute(email.attributes, "aria-describedby")).toBe(
      "account-help contact-email-description contact-email-error",
    );
    expect(attribute(email.attributes, "aria-invalid")).toBe("true");
    expect(email.attributes).toContain(" disabled");
    expect(html).toContain('id="contact-email-description"');
    expect(html).toContain('id="contact-email-error"');
    expect(html).toContain('role="alert"');
  });
});

describe("owner editor field accessibility", () => {
  it("names Food Retail inputs, selects, and textareas from visible labels", () => {
    const html = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={sampleFoodRetailDraft}
        initialRevision={7}
        initiallyPublished={false}
        platformUrl="https://bakery.cornershop.dev"
      />,
    );

    expectNamedEditorControls(html);
    associatedControl(html, "Business name", "input");
    associatedControl(html, "Shop type", "select");
    associatedControl(html, "Pickup details", "textarea");
    associatedControl(html, "Link 1 label", "input");
    expect(html).not.toContain('aria-label="fr link 1 label"');
  });

  it("names Local Service controls, including both composite fields", () => {
    const html = renderToStaticMarkup(
      <LocalServiceDashboard
        initialDraft={sampleLocalServiceSiteDraft}
        initialRevision={7}
        email="owner@harbourelectrical.example"
        brand={FACTORY_BRAND}
        canSwitchWorkspace={false}
        initiallyPublished={false}
        platformUrl="https://harbour-electrical.cornershop.dev"
      />,
    );

    expectNamedEditorControls(html);
    associatedControl(html, "Business name", "input");
    associatedControl(html, "Trade type", "select");
    associatedControl(html, "Description", "textarea");
    const insurance = associatedControl(html, "Insurance posture", "select");
    expect(insurance.id).toBe("insurance-posture");
    expect(labelledByText(html, "insurance-posture-evidence")).toBe(
      "Insurance posture detail",
    );
    expect(labelledByText(html, "service-price-unit-0-0-price")).toBe(
      "Price / unit price",
    );
    expect(labelledByText(html, "service-price-unit-0-0-unit")).toBe(
      "Price / unit unit",
    );
  });

  it("names restaurant menu controls without changing existing switch labels", () => {
    const html = renderToStaticMarkup(
      <RestaurantMenuEditor
        draft={sampleRestaurant}
        dirty={false}
        saving={false}
        saveError={null}
        validationIssues={[]}
        canUndo={false}
        regeneratingLocale={null}
        onMutation={() => {}}
        onTranslationChange={() => {}}
        onReviewTranslation={() => {}}
        onRegenerateTranslation={() => {}}
        onUndo={() => {}}
        onSave={() => {}}
      />,
    );

    expectNamedEditorControls(html);
    associatedControl(html, "Item name", "input");
    associatedControl(html, "Description", "textarea");
    associatedControl(html, "Currency", "select");
    expect(html).toContain('for="available-0-0"');
    expect(html).toContain('id="available-0-0"');
  });

  it("preserves explicit restaurant integration control IDs", () => {
    const html = renderToStaticMarkup(
      <RestaurantIntegrationEditor
        draft={sampleRestaurant}
        dirty={false}
        saving={false}
        saveError={null}
        validationIssues={[]}
        savedRevision={7}
        canUndo={false}
        onMutation={() => {}}
        onTranslationLabelChange={() => {}}
        onReviewTranslation={() => {}}
        onUndo={() => {}}
        onSave={() => {}}
      />,
    );

    expectNamedEditorControls(html);
    expect(associatedControl(html, "Link type", "select").id).toBe(
      "integration-type-0",
    );
    expect(
      associatedControl(html, "Customer-facing label", "input").id,
    ).toBe("integration-label-0");
    expect(associatedControl(html, "HTTPS destination", "input").id).toBe(
      "integration-url-0",
    );
    expect(html).not.toContain("<label>Provider identity</label>");
  });

  it("keeps the client-selected localized integration on the shared field contract", () => {
    expect(restaurantIntegrationEditorSource).toContain(
      '<Field label="Localized customer-facing label">',
    );
    expect(restaurantIntegrationEditorSource).toContain(
      'id={`translated-integration-${integrationIndex}`}',
    );
    expect(restaurantIntegrationEditorSource).not.toContain("function Field(");
  });
});

function associatedControlIds(html: string, label: string) {
  const labels = html.matchAll(
    new RegExp(
      `<label\\b[^>]*\\bfor="([^"]+)"[^>]*>${escapeRegex(label)}</label>`,
      "g",
    ),
  );
  return [...labels].map((match) => match[1]);
}

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
  return {
    id,
    attributes: controlById(html, id, tag, label),
  };
}

function expectNamedEditorControls(html: string) {
  const controls = html.matchAll(/<(input|select|textarea)\b([^>]*)>/g);
  const controlIds = new Set<string>();
  for (const match of controls) {
    const [element, tag, attributes] = match;
    if (tag === "input" && !attributes.includes('data-slot="input"')) {
      continue;
    }

    const directLabel = attribute(attributes, "aria-label")?.trim();
    const labelledBy = attribute(attributes, "aria-labelledby");
    const id = attribute(attributes, "id");
    if (id !== undefined) {
      expect(
        controlIds.has(id),
        `Expected a unique control ID, received ${id}`,
      ).toBe(false);
      controlIds.add(id);
    }
    const hasExplicitLabel =
      id !== undefined &&
      new RegExp(`<label\\b[^>]*\\bfor="${escapeRegex(id)}"`).test(html);
    const hasLabelledBy =
      labelledBy !== undefined &&
      labelledBy
        .split(/\s+/)
        .filter(Boolean)
        .every((labelId) => elementTextById(html, labelId).length > 0);

    expect(
      Boolean(directLabel || hasExplicitLabel || hasLabelledBy),
      `Expected an accessible name for ${element}`,
    ).toBe(true);
  }
}

function controlById(
  html: string,
  id: string,
  tag: "input" | "select" | "textarea",
  label?: string,
) {
  const control = html.match(
    new RegExp(`<${tag}\\b(?=[^>]*\\bid="${escapeRegex(id)}")[^>]*>`),
  );
  expect(
    control,
    label
      ? `Expected ${tag}#${id} to be associated with “${label}”`
      : `Expected ${tag}#${id}`,
  ).not.toBeNull();
  return control![0];
}

function labelledByText(html: string, controlId: string) {
  const control = html.match(
    new RegExp(
      `<(?:input|select|textarea)\\b(?=[^>]*\\bid="${escapeRegex(controlId)}")[^>]*>`,
    ),
  );
  expect(control, `Expected control #${controlId}`).not.toBeNull();
  const labelledBy = attribute(control![0], "aria-labelledby");
  expect(labelledBy, `Expected #${controlId} to use aria-labelledby`).toBeDefined();
  return labelledBy!
    .split(/\s+/)
    .map((id) => elementTextById(html, id))
    .join(" ");
}

function elementTextById(html: string, id: string) {
  const element = html.match(
    new RegExp(
      `<[^>]+\\bid="${escapeRegex(id)}"[^>]*>([\\s\\S]*?)</[^>]+>`,
    ),
  );
  return (element?.[1] ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes: string, name: string) {
  return attributes.match(
    new RegExp(`(?:^|\\s)${escapeRegex(name)}="([^"]*)"`),
  )?.[1];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
