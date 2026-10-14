# Autonomous operator

The factory can be read by a private Grok session. It cannot launch itself.

`bun run operator:mcp` is a stdio MCP server. `bun run operator:daily-brief`
prints the same redacted brief as JSON. Both refuse to start until
`OPERATOR_MCP_TOKEN` is set to at least 32 characters and is distinct from the
healthcheck, ingest, auth, Stripe, and Resend secrets. The token is an
operator-machine gate. It is not part of the public app and it is not a
required production container variable.

The server exposes three tools:

| Tool | Result |
| --- | --- |
| `read_operating_contract` | Launch stays blocked. Lists what the agent may do and the actions that do not exist. |
| `read_daily_brief` | Portfolio counts, analytics windows, alert and outreach posture, vertical launch state, and human attention. |
| `read_site_operations` | One slug, or the bounded site list. |

Every tool is read-only. The server does not register a tool that sends
outreach, issues a claim invitation, publishes or rolls back a site, creates a
charge, or changes DNS. Kill criteria stay `unmeasured`. A brief cannot close
them.

Site rows omit contact emails, phone numbers, street addresses, outreach
bodies, claim tokens, checkout session ids, and connection strings. Names are
kept so the operator can recognise a business, then passed through the same
redaction pass as the rest of the payload. A read failure returns
`operator_read_failed` and does not include the provider error.

## What the agent may do

Read the contract and the brief. Open a pull request for a defect in this
repository. Report the brief and the human gates.

## What stays human

Distribution and the one-city concierge test. Outreach delivery, which remains
behind the reviewed consent fence. Owner confirmation of prices, hours,
identity, and photos. The first paid restaurant proof and pricing validation.

Point the process at a read-only database role when the brief reads
production. The application `DATABASE_URL` can write; this server's tools do
not, and a future tool must not grow a write path inside this module.

## Grok session

Run Grok from this repository and add the server to the user MCP config, not
to a committed file. Replace the placeholders locally. Do not commit either
value.

```toml
[mcp_servers.cornershop-operator]
command = "bun"
args = ["scripts/operator-mcp.ts"]
enabled = true
env = { OPERATOR_MCP_TOKEN = "...", DATABASE_URL = "..." }
```

The daily brief is the standing job. Ask for `read_daily_brief`, then act only
inside the contract. A green brief is not a launch.
