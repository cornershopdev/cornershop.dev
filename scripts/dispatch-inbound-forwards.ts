import { getDb } from "@/lib/db";
import { dispatchDueOutreachInboundForwards } from "@/lib/outreach-inbound-forward";

try {
  const outcomes = await dispatchDueOutreachInboundForwards();
  console.log(
    JSON.stringify(
      {
        command: "dispatch-inbound-forwards",
        outcomes,
        completedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  if (outcomes.exhausted > 0 || outcomes["configuration-invalid"] > 0) {
    process.exitCode = 1;
  }
} catch {
  console.error(
    JSON.stringify({
      command: "dispatch-inbound-forwards",
      completed: false,
      failure: "database_configuration_or_delivery_unavailable",
      failedAt: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
} finally {
  try {
    await getDb().$disconnect();
  } catch {
    // The safe failure result above already captures an unavailable database.
  }
}
