import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  OPERATOR_MCP_INSTRUCTIONS,
  operatingContract,
} from "@/lib/operator-autonomy/contract";
import { redactOperatorValue } from "@/lib/operator-autonomy/redact";
import { loadOperatorAutonomySnapshot } from "@/lib/operator-autonomy/snapshot";
import { buildDailyBrief } from "@/lib/operator-autonomy/brief";
import type { OperatorAutonomySnapshot } from "@/lib/operator-autonomy/types";
import { getDb } from "@/lib/db";

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const slugSchema = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80)
    .optional()
    .describe("Site slug. Omit it to read the brief's bounded site list."),
});

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export function createOperatorMcpServer(options?: {
  loadSnapshot?: () => Promise<OperatorAutonomySnapshot>;
}): McpServer {
  const loadSnapshot =
    options?.loadSnapshot ?? (() => loadOperatorAutonomySnapshot(getDb()));
  const server = new McpServer(
    { name: "cornershop-operator", version: "0.1.0" },
    { instructions: OPERATOR_MCP_INSTRUCTIONS },
  );

  server.registerTool(
    "read_operating_contract",
    {
      title: "Read operating contract",
      description:
        "Read the autonomous-operator contract. Read-only. Launch stays blocked. This tool does not send mail, publish, charge, or change DNS.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => guarded(() => operatingContract()),
  );

  server.registerTool(
    "read_daily_brief",
    {
      title: "Read daily brief",
      description:
        "Read redacted factory totals, vertical launch state, alerts, and the human gates. Read-only. Does not send mail, publish, charge, or change DNS.",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () =>
      guarded(async () => buildDailyBrief(await loadSnapshot())),
  );

  server.registerTool(
    "read_site_operations",
    {
      title: "Read site operations",
      description:
        "Read redacted operational state for one slug, or the bounded site list. Read-only. Contact details, outreach bodies, and secrets are omitted.",
      inputSchema: slugSchema,
      annotations: READ_ONLY,
    },
    async ({ slug }) =>
      guarded(async () => {
        const snapshot = await loadSnapshot();
        if (!slug) {
          const brief = buildDailyBrief(snapshot);
          return {
            sites: brief.sites,
            omittedSiteCount: brief.omittedSiteCount,
          };
        }
        const site = snapshot.sites.find((candidate) => candidate.slug === slug);
        if (!site) {
          throw new OperatorWindowMiss();
        }
        return site;
      }),
  );

  return server;
}

class OperatorWindowMiss extends Error {
  constructor() {
    super("site_not_in_operator_window");
  }
}

async function guarded(load: () => Promise<unknown> | unknown): Promise<ToolResult> {
  try {
    const value = await load();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(redactOperatorValue(value)),
        },
      ],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text:
            error instanceof OperatorWindowMiss
              ? "site_not_in_operator_window"
              : "operator_read_failed",
        },
      ],
    };
  }
}
