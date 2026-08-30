import { describe, expect, it } from "bun:test";
import {
  OPERATOR_ALERT_DELIVERY_TIMEOUT_MS,
  OPERATOR_ALERT_DISPATCH_BATCH_SIZE,
} from "@/lib/operator-alert-policy";
import { OUTREACH_INBOUND_FORWARD_BATCH_SIZE } from "@/lib/outreach-inbound-forward-policy";
import { RESEND_SEND_TIMEOUT_MS } from "@/lib/resend";

const deployScript = await Bun.file(
  new URL("../../deploy/aws/deploy.sh", import.meta.url),
).text();
const monitorScript = await Bun.file(
  new URL("../../scripts/monitor-public-site.ts", import.meta.url),
).text();
const environmentExample = await Bun.file(
  new URL("../../.env.example", import.meta.url),
).text();

function parameterList(name: "required_parameters" | "optional_parameters") {
  const entries = deployScript.match(
    new RegExp(`${name}=\\(([\\s\\S]*?)\\n\\)`),
  )?.[1];
  expect(entries).toBeDefined();
  return new Set(entries?.trim().split(/\s+/) ?? []);
}

describe("operator alert service deployment", () => {
  it("keeps alert draining out of the public health service", () => {
    expect(deployScript).toContain(
      "run operator:monitor-public-site --execute",
    );
    expect(deployScript).toContain("run operator:dispatch-alerts");
    expect(monitorScript).not.toContain("dispatchDueOperatorAlerts");
    expect(deployScript).toContain(
      "systemctl enable --now cornershopdev-public-health.timer",
    );
    expect(deployScript).toContain(
      "systemctl enable --now cornershopdev-operator-alerts.timer",
    );
  });

  it("keeps a saturated alert batch inside its service timeout", () => {
    const alertService = deployScript.match(
      /Description=Dispatch due Cornershopdev operator alerts[\s\S]*?TimeoutStartSec=(\d+)s[\s\S]*?operator:dispatch-alerts/,
    );
    expect(alertService).not.toBeNull();
    const serviceTimeoutMs = Number(alertService?.[1]) * 1_000;
    const saturatedBatchDeliveryMs =
      OPERATOR_ALERT_DISPATCH_BATCH_SIZE *
      OPERATOR_ALERT_DELIVERY_TIMEOUT_MS;

    expect(saturatedBatchDeliveryMs).toBe(25_000);
    expect(saturatedBatchDeliveryMs).toBeLessThan(serviceTimeoutMs);
  });

  it("isolates bounded inbound read-copy draining in its own timer", () => {
    expect(deployScript).toContain("run operator:dispatch-inbound-forwards");
    expect(deployScript).toContain(
      "systemctl enable --now cornershopdev-inbound-forwards.timer",
    );
    const forwardService = deployScript.match(
      /Description=Dispatch due Cornershopdev inbound read copies[\s\S]*?TimeoutStartSec=(\d+)s[\s\S]*?operator:dispatch-inbound-forwards/,
    );
    expect(forwardService).not.toBeNull();
    const serviceTimeoutMs = Number(forwardService?.[1]) * 1_000;
    const saturatedBatchDeliveryMs =
      OUTREACH_INBOUND_FORWARD_BATCH_SIZE * RESEND_SEND_TIMEOUT_MS;

    expect(saturatedBatchDeliveryMs).toBe(40_000);
    expect(saturatedBatchDeliveryMs).toBeLessThan(serviceTimeoutMs);
  });
});

describe("production deployment contract", () => {
  it("preserves required release and endpoint-specific configuration", () => {
    const required = parameterList("required_parameters");
    const optional = parameterList("optional_parameters");

    for (const name of [
      "FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_KEY",
      "OPERATOR_LEAD_INGEST_TOKEN",
      "RESEND_INBOUND_WEBHOOK_SECRET",
      "RESEND_WEBHOOK_SECRET",
      "SUPERADMIN_EMAILS",
    ]) {
      expect(required).toContain(name);
      expect(optional).not.toContain(name);
    }
    expect(required).not.toContain("OUTREACH_INBOUND_FORWARD_TO");
    expect(optional).toContain("OUTREACH_INBOUND_FORWARD_TO");
    expect(environmentExample).toContain("OUTREACH_INBOUND_FORWARD_TO=\n");
  });

  it("proves analytics on factory previews and off customer storefronts before cutover", () => {
    expect(deployScript).toContain(
      'get("cornershop.dev", "/preview/le-petit-meunier")',
    );
    expect(deployScript).toContain('preview.includes("preview_view")');
    expect(deployScript).toContain(
      'get("le-petit-meunier.restofront.com", "/")',
    );
    expect(deployScript).toContain(
      'customer.includes("id=\\\"factory-analytics\\\"")',
    );
    expect(deployScript).toContain(
      "release-state factory-analytics-ready sha=",
    );
  });

  it("propagates every documented photo model, cost, concurrency, and policy control", () => {
    const optional = parameterList("optional_parameters");

    for (const name of [
      "OPENROUTER_IMAGE_MODEL",
      "PHOTO_DISCOVERY_MAX_IMAGES",
      "PHOTO_ENHANCEMENT_BATCH_MAX_IMAGES",
      "PHOTO_ENHANCEMENT_CONCURRENCY",
      "PHOTO_ENHANCEMENT_ESTIMATED_COST_MICROS",
      "PHOTO_ENHANCEMENT_MODEL",
      "PHOTO_ENHANCEMENT_PER_IMAGE_CEILING_MICROS",
      "PHOTO_ENHANCEMENT_PER_SITE_CEILING_MICROS",
      "PHOTO_INGEST_CONCURRENCY",
    ]) {
      expect(optional).toContain(name);
    }
  });

  it("cleans every immutable bundle, monitor, and alert temporary file", () => {
    const cleanupTrap = deployScript.match(/trap 'rm -f ([^']+)' EXIT/g)?.at(-1);

    for (const variable of [
      "$temporary_environment",
      "$artifact_file",
      "$bootstrap_file",
      "$caddy_fragment_file",
      "$host_launcher_file",
      "$temporary_monitor_service",
      "$temporary_monitor_timer",
      "$temporary_alert_service",
      "$temporary_alert_timer",
      "$temporary_forward_service",
      "$temporary_forward_timer",
    ]) {
      expect(cleanupTrap).toContain(variable);
    }
  });
});
