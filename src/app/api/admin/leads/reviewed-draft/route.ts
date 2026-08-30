import { NextResponse } from "next/server";
import { z } from "zod";
import {
  importReviewedOperatorDraftBatch,
  parseReviewedDraftBatchImport,
} from "@/lib/operator-reviewed-draft-import";
import { isOperatorLeadIngestAuthorized } from "@/lib/operator-lead-ingest-auth";
import { limitOperatorLeadIngest } from "@/lib/rate-limit";
import {
  ImportConflictError,
  OperatorImportConflictError,
} from "@/lib/site-persistence";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isOperatorLeadIngestAuthorized(request)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      {
        status: 401,
        headers: {
          "Cache-Control": "no-store",
          "WWW-Authenticate": "Bearer",
        },
      },
    );
  }

  const rateLimit = await limitOperatorLeadIngest(request);
  if (!rateLimit.success) {
    return NextResponse.json(
      {
        error:
          rateLimit.reason === "unavailable"
            ? "Reviewed draft import is temporarily unavailable."
            : "Too many reviewed draft imports. Try again later.",
      },
      { status: rateLimit.reason === "unavailable" ? 503 : 429 },
    );
  }

  try {
    const input = parseReviewedDraftBatchImport(await request.json());
    const imported = await importReviewedOperatorDraftBatch(input);
    return NextResponse.json(
      { ok: true, ...imported },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Check the reviewed draft." },
        { status: 400 },
      );
    }
    if (error instanceof Error && error.message.includes("public source URL")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (
      error instanceof ImportConflictError ||
      error instanceof OperatorImportConflictError
    ) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[operator-reviewed-draft-import] failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "The reviewed draft could not be imported." },
      { status: 503 },
    );
  }
}
