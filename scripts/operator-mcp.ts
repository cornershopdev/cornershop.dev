import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { operatorMcpAccessProblem } from "@/lib/operator-autonomy/access";
import { createOperatorMcpServer } from "@/lib/operator-autonomy/mcp";

const problem = operatorMcpAccessProblem(process.env);
if (problem) {
  console.error(
    JSON.stringify({
      command: "operator-mcp",
      completed: false,
      failure: problem,
    }),
  );
  process.exit(1);
}

serveStdio(() => createOperatorMcpServer());
