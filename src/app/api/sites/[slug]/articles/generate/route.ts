import { z } from "zod";
import {
  accessFailureResponse,
  getSiteAccess,
} from "@/lib/authorization";
import { isSameOriginMutation } from "@/lib/request-origin";
import { startArticleBatch } from "@/lib/articles/start-batch";
import {
  ARTICLE_MUTATION_GATE_REASON,
  areArticleMutationsGated,
} from "@/lib/articles/mutation-gate";

const generateSchema = z.object({
  count: z.number().int().min(1).max(8).default(4),
});

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/sites/[slug]/articles/generate">,
) {
  if (!isSameOriginMutation(request, { requireOrigin: true })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { slug } = await params;
  const access = await getSiteAccess(slug);
  if (!access.ok) return accessFailureResponse(access);
  if (await areArticleMutationsGated()) {
    return Response.json(
      { error: ARTICLE_MUTATION_GATE_REASON },
      { status: 503 },
    );
  }

  const parsed = generateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return Response.json(
      { error: "Batch size must be between 1 and 8." },
      { status: 400 },
    );
  }

  const result = await startArticleBatch({
    siteId: access.site.id,
    slug,
    requestedBy: access.user.id,
    count: parsed.data.count,
  });
  if (!result.ok) {
    return Response.json({ error: result.reason }, { status: result.status });
  }
  return Response.json({ ok: true, runId: result.runId });
}
