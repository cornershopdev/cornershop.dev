import { z } from "zod";

export const ANALYTICS_WINDOWS = [7, 30, 90] as const;

/** Booking requests counted as live-site leads. Shared with the operator brief. */
export const LIVE_BOOKING_REQUEST_SOURCE = "live-site-form";

export type AnalyticsWindowDays = (typeof ANALYTICS_WINDOWS)[number];

/**
 * The only analytics facts an anonymous browser may assert. Lead creation is
 * server-owned and therefore deliberately absent from this schema.
 */
export const analyticsEventInputSchema = z
  .object({
    id: z.uuid(),
    visitId: z.uuid(),
    type: z.enum(["SITE_VIEW", "CTA_CLICK"]),
  })
  .strict();

export type AnalyticsEventInput = z.infer<typeof analyticsEventInputSchema>;

export type AnalyticsWindowDto = {
  days: AnalyticsWindowDays;
  visits: number;
  ctaVisitors: number;
  bookingLeads: number;
  ctaRate: number;
  leadRate: number;
};

export type AnalyticsSummaryDto = {
  generatedAt: string;
  windows: AnalyticsWindowDto[];
};

export type SiteAnalyticsRowDto = {
  visits: number;
  ctaVisitors: number;
  bookingLeads: number;
  ctaRate: number;
  leadRate: number;
};

export function buildEmptyAnalyticsSummary(
  now = new Date(),
): AnalyticsSummaryDto {
  return {
    generatedAt: now.toISOString(),
    windows: ANALYTICS_WINDOWS.map((days) =>
      buildAnalyticsWindowDto({
        days,
        visits: 0,
        ctaVisitors: 0,
        bookingLeads: 0,
      }),
    ),
  };
}

export function buildAnalyticsWindowDto({
  days,
  visits,
  ctaVisitors,
  bookingLeads,
}: {
  days: AnalyticsWindowDays;
  visits: number;
  ctaVisitors: number;
  bookingLeads: number;
}): AnalyticsWindowDto {
  return {
    days,
    visits,
    ctaVisitors,
    bookingLeads,
    ctaRate: conversionRate(ctaVisitors, visits),
    leadRate: conversionRate(bookingLeads, visits),
  };
}

function conversionRate(numerator: number, denominator: number): number {
  if (denominator <= 0 || numerator <= 0) return 0;
  return numerator / denominator;
}
