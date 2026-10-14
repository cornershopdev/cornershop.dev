import { getDb } from "@/lib/db";
import { operatorMcpAccessProblem } from "@/lib/operator-autonomy/access";
import { loadDailyBrief } from "@/lib/operator-autonomy/snapshot";

const problem = operatorMcpAccessProblem(process.env);
if (problem) {
  console.error(
    JSON.stringify({
      command: "operator-daily-brief",
      completed: false,
      failure: problem,
    }),
  );
  process.exitCode = 1;
} else {
  try {
    const brief = await loadDailyBrief();
    console.log(JSON.stringify(brief));
  } catch {
    console.error(
      JSON.stringify({
        command: "operator-daily-brief",
        completed: false,
        failure: "operator_read_failed",
      }),
    );
    process.exitCode = 1;
  } finally {
    try {
      await getDb().$disconnect();
    } catch {
      // The failure result above already covers an unavailable database.
    }
  }
}
