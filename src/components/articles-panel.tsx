"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export type DashboardArticle = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  locale: string;
  status: "DRAFT" | "PUBLISHED";
  topicTitle: string;
  publishedAt: string | null;
  createdAt: string;
};

/**
 * Owner review queue for generated articles. Publishing is a single
 * confirmation: drafts are pre-screened by the generation guardrails, so the
 * owner's job is taste, not fact-checking. Regeneration asks the durable
 * workflow for a fresh batch; the API enforces the cadence gate.
 */
export function ArticlesPanel({ siteSlug }: { siteSlug: string }) {
  const [articles, setArticles] = useState<DashboardArticle[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(
      `/api/sites/${encodeURIComponent(siteSlug)}/articles`,
      { cache: "no-store", signal },
    );
    if (!response.ok) throw new Error("Could not load articles.");
    const data = (await response.json()) as { articles: DashboardArticle[] };
    return data.articles;
  }, [siteSlug]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) setArticles(loaded);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setError("Could not load articles. Reload to try again.");
        }
      });
    return () => {
      controller.abort();
    };
  }, [load]);

  const act = async (articleId: string, action: "publish" | "unpublish") => {
    setBusyId(articleId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/sites/${encodeURIComponent(siteSlug)}/articles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ articleId, action }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? "That action failed.");
      }
      setNotice(
        action === "publish"
          ? "Published. It is live on your blog now."
          : "Unpublished. The page is gone from your site.",
      );
      setArticles(await load());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/sites/${encodeURIComponent(siteSlug)}/articles/generate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ count: 4 }),
        },
      );
      const data = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(data?.error ?? "Generation could not start.");
      }
      setNotice(
        "A batch is being written. Drafts appear here within a few minutes.",
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Blog articles</CardTitle>
        <CardDescription>
          Locally relevant articles written from your own menu, hours and
          location. Nothing publishes without your approval.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700">
            {notice}
          </p>
        ) : null}

        {articles === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Loading articles…
          </p>
        ) : articles.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No articles yet. Generate your first batch to give visitors a
            reason to come back.
          </p>
        ) : (
          <ul className="divide-y rounded-xl border">
            {articles.map((article) => (
              <li
                key={article.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {article.status === "PUBLISHED" ? (
                      <Badge className="bg-emerald-500/10 text-emerald-700">
                        Live
                      </Badge>
                    ) : (
                      <Badge variant="outline">Draft</Badge>
                    )}
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {article.topicTitle}
                    </span>
                  </div>
                  <p className="mt-1 font-medium">{article.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">
                    {article.excerpt}
                  </p>
                  {article.status === "PUBLISHED" ? (
                    <a
                      href={`/blog/${article.slug}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-block text-xs underline underline-offset-4"
                    >
                      View live page
                    </a>
                  ) : null}
                </div>
                <Button
                  variant={article.status === "DRAFT" ? "default" : "outline"}
                  size="sm"
                  disabled={busyId === article.id}
                  onClick={() => act(article.id, article.status === "DRAFT" ? "publish" : "unpublish")}
                >
                  {busyId === article.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : article.status === "DRAFT" ? (
                    "Publish"
                  ) : (
                    "Unpublish"
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div>
          <Button onClick={generate} disabled={generating} size="sm">
            {generating ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Sparkles />
            )}
            Generate a batch of 4
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
