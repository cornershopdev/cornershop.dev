import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { describe, expect, it } from "bun:test";
import { buildDailyBrief } from "@/lib/operator-autonomy/brief";
import {
  FORBIDDEN_OPERATOR_ACTIONS,
  OPERATOR_MCP_TOOLS,
} from "@/lib/operator-autonomy/contract";
import { createOperatorMcpServer } from "@/lib/operator-autonomy/mcp";
import {
  BRIEF_SITE_LIMIT,
  emptyCounts,
  type OperatorAutonomySnapshot,
} from "@/lib/operator-autonomy/types";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import {
  ArticleBatchStatus,
  ArticleStatus,
  OperatorAlertKind,
  OperatorAlertStatus,
  OutreachStatus,
  SiteStatus,
  SubscriptionStatus,
  Vertical,
} from "@/generated/prisma/enums";

const secretUrl = "postgres://operator:supersecret@db.internal/cornershop";

function snapshot(): OperatorAutonomySnapshot {
  const sites = Array.from({ length: BRIEF_SITE_LIMIT + 1 }, (_, index) => ({
    slug: `site-${index}`,
    name: index === 0 ? "Ada ada@example.com" : `Site ${index}`,
    vertical: "RESTAURANT" as const,
    status: "PREVIEW_READY" as const,
    createdAt: "2026-10-14T00:00:00.000Z",
    ownerCount: 0,
    subscriptionStatus: null,
    latestImportStatus: "READY" as const,
    pendingBookingRequestCount: 0,
    domainCount: 0,
    verifiedDomainCount: 0,
    isPublished: false,
    pendingSourceSuggestionCount: 0,
    draftArticleCount: 0,
    publishedArticleCount: 0,
    outreachPaused: true,
    invitationState: "NONE" as const,
    contentReview: {
      missingFields: [],
      heroImage: "missing" as const,
      translationCount: 0,
      integrationCount: 0,
      catalogItemCount: 0,
    },
    blockers: [],
  }));
  return {
    generatedAt: "2026-10-14T00:00:00.000Z",
    portfolio: {
      sites: sites.length,
      signedUpSites: 0,
      pendingBookingRequests: 0,
      sitesByStatus: emptyCounts(Object.values(SiteStatus)),
      sitesByVertical: emptyCounts(Object.values(Vertical)),
      subscriptionsByStatus: emptyCounts(Object.values(SubscriptionStatus)),
      analytics: buildEmptyAnalyticsSummary(new Date("2026-10-14T00:00:00.000Z")),
    },
    alerts: {
      byStatus: emptyCounts(Object.values(OperatorAlertStatus)),
      openByKind: emptyCounts(Object.values(OperatorAlertKind)),
    },
    outreach: {
      globalPaused: true,
      pausedSiteCount: 0,
      messagesByStatus: emptyCounts(Object.values(OutreachStatus)),
    },
    content: {
      articlesByStatus: emptyCounts(Object.values(ArticleStatus)),
      articleBatchesByStatus: emptyCounts(Object.values(ArticleBatchStatus)),
      pendingSourceSuggestions: 0,
    },
    sites,
  };
}

async function connect(loadSnapshot: () => Promise<OperatorAutonomySnapshot>) {
  const server = createOperatorMcpServer({ loadSnapshot });
  const client = new Client({ name: "operator-test", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server };
}

function textOf(result: { content: Array<{ type: string; text?: string }> }) {
  const block = result.content.find((entry) => entry.type === "text");
  if (!block?.text) throw new Error("missing text content");
  return block.text;
}

describe("operator MCP server", () => {
  it("exposes only the read-only contract tools", async () => {
    const { client, server } = await connect(async () => snapshot());
    const listed = await client.listTools();

    expect(listed.tools.map((tool) => tool.name)).toEqual([
      ...OPERATOR_MCP_TOOLS,
    ]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(
      true,
    );
    for (const action of FORBIDDEN_OPERATOR_ACTIONS) {
      expect(listed.tools.map((tool) => tool.name)).not.toContain(action);
    }

    await client.close();
    await server.close();
  });

  it("returns a blocked contract and a redacted brief", async () => {
    const { client, server } = await connect(async () => snapshot());
    const contract = await client.callTool({ name: "read_operating_contract" });
    const brief = await client.callTool({ name: "read_daily_brief" });
    const contractBody = JSON.parse(textOf(contract));
    const briefBody = JSON.parse(textOf(brief));

    expect(contractBody.launch.status).toBe("blocked");
    expect(contractBody.tools).toEqual([...OPERATOR_MCP_TOOLS]);
    expect(briefBody.launch.status).toBe("blocked");
    expect(briefBody.sites).toHaveLength(BRIEF_SITE_LIMIT);
    expect(JSON.stringify(briefBody)).not.toContain("ada@example.com");
    expect(buildDailyBrief(snapshot()).launch.status).toBe("blocked");

    const hidden = await client.callTool({
      name: "read_site_operations",
      arguments: { slug: `site-${BRIEF_SITE_LIMIT}` },
    });
    expect(JSON.parse(textOf(hidden)).slug).toBe(`site-${BRIEF_SITE_LIMIT}`);

    const missing = await client.callTool({
      name: "read_site_operations",
      arguments: { slug: "missing-site" },
    });
    expect(missing.isError).toBe(true);
    expect(textOf(missing)).toBe("site_not_in_operator_window");

    await client.close();
    await server.close();
  });

  it("hides provider failures", async () => {
    const { client, server } = await connect(async () => {
      throw new Error(secretUrl);
    });
    const failed = await client.callTool({ name: "read_daily_brief" });

    expect(failed.isError).toBe(true);
    expect(textOf(failed)).toBe("operator_read_failed");
    expect(textOf(failed)).not.toContain("supersecret");

    await client.close();
    await server.close();
  });
});
