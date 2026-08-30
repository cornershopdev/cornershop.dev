"use client";

import type { FactoryAnalyticsEvent } from "@/lib/factory-analytics";

type FactoryAnalyticsWindow = Window & {
  __factoryAnalyticsQueue?: FactoryAnalyticsEvent[];
  posthog?: {
    capture: (
      name: FactoryAnalyticsEvent["name"],
      properties: FactoryAnalyticsEvent["properties"],
    ) => void;
  };
};

export function captureFactoryAnalyticsEvent(
  event: FactoryAnalyticsEvent,
): void {
  const analyticsWindow = window as FactoryAnalyticsWindow;
  if (analyticsWindow.posthog) {
    analyticsWindow.posthog.capture(event.name, event.properties);
    return;
  }
  analyticsWindow.__factoryAnalyticsQueue ??= [];
  analyticsWindow.__factoryAnalyticsQueue.push(event);
}
