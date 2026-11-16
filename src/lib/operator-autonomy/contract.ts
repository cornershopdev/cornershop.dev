export const OPERATOR_MCP_TOOLS = [
  "read_operating_contract",
  "read_daily_brief",
  "read_site_operations",
  "read_lead_delivery",
] as const;

export type OperatorMcpTool = (typeof OPERATOR_MCP_TOOLS)[number];

export const FORBIDDEN_OPERATOR_ACTIONS = [
  "send_outreach",
  "issue_claim_invitation",
  "publish_site",
  "rollback_site",
  "create_charge",
  "change_dns",
  "mark_kill_criterion",
  "declare_launch",
] as const;

export const OPERATOR_AGENT_MAY = [
  "Read the operating contract, the daily brief, and redacted site operations.",
  "Read whether a private preview can be prepared and why claim email stays blocked.",
  "Open a pull request for a defect in this repository.",
  "Report the brief and the human gates to the operator.",
] as const;

export const OPERATOR_AGENT_MUST_NOT = [
  "Send outreach or approve a recipient.",
  "Issue a claim invitation.",
  "Publish or roll back a customer site.",
  "Create or change a Stripe charge.",
  "Change DNS or MX.",
  "Mark a kill criterion passed.",
  "Declare a niche launched or the factory autonomously live.",
] as const;

export const OPERATOR_HUMAN_GATES = [
  "Distribution and the one-city concierge test stay with the operator.",
  "Outreach delivery stays behind the reviewed consent fence.",
  "Owner confirmation of prices, hours, identity, and photos stays required.",
  "First paid restaurant proof and pricing validation stay human-only.",
] as const;

export const KILL_CRITERIA = [
  {
    id: "conversations",
    statement:
      "The best compliant channel produces at least 8% conversations from 50 delivered previews.",
  },
  {
    id: "paid",
    statement:
      "At least 5 paying customers from about 60 previews, or at least 4% preview to paid.",
  },
  {
    id: "cac",
    statement:
      "Customer acquisition cost stays at or below $200 at the $49 monthly price.",
  },
  {
    id: "support",
    statement:
      "Ongoing support stays at or below 30 minutes per customer per month.",
  },
  {
    id: "claim",
    statement:
      "Claim completion stays under 20 minutes, and at least 60% of owners who start finish.",
  },
  {
    id: "menu-update",
    statement:
      "At least 30% of live customers complete a prompted menu-update cycle.",
  },
  {
    id: "legal",
    statement:
      "The preview and outreach motion draw no credible legal challenge.",
  },
] as const;

export const LAUNCH_STATEMENT =
  "Autonomous launch is blocked. This server can read factory state. It cannot send mail, publish a customer site, charge a customer, or close the launch gates.";

export const OPERATOR_MCP_INSTRUCTIONS = [
  "Cornershop operator server. Every tool is read-only.",
  LAUNCH_STATEMENT,
  `You may: ${OPERATOR_AGENT_MAY.join(" ")}`,
  `You must not: ${OPERATOR_AGENT_MUST_NOT.join(" ")}`,
].join(" ");

export type OperatingContract = {
  launch: {
    status: "blocked";
    statement: string;
  };
  tools: readonly OperatorMcpTool[];
  forbiddenActions: readonly (typeof FORBIDDEN_OPERATOR_ACTIONS)[number][];
  agentMay: readonly string[];
  agentMustNot: readonly string[];
  humanGates: readonly string[];
  killCriteria: Array<{
    id: (typeof KILL_CRITERIA)[number]["id"];
    statement: string;
    status: "unmeasured";
  }>;
};

export function operatingContract(): OperatingContract {
  return {
    launch: {
      status: "blocked",
      statement: LAUNCH_STATEMENT,
    },
    tools: OPERATOR_MCP_TOOLS,
    forbiddenActions: FORBIDDEN_OPERATOR_ACTIONS,
    agentMay: OPERATOR_AGENT_MAY,
    agentMustNot: OPERATOR_AGENT_MUST_NOT,
    humanGates: OPERATOR_HUMAN_GATES,
    killCriteria: KILL_CRITERIA.map((criterion) => ({
      ...criterion,
      status: "unmeasured" as const,
    })),
  };
}
