export type { ClientPublicationHistoryItem } from "@/lib/owner-operations";

export type DomainSetup = {
  hostname: string;
  hostnames: string[];
  attached: boolean;
  verified: boolean;
  records: Array<{ type: string; name: string; value: string }>;
  tls: {
    status: "PENDING" | "READY" | "ERROR";
    checkedAt: string | null;
    message: string;
  };
  siteStatus: "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED";
  previewPath: string;
  publicUrl: string;
};
