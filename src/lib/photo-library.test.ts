import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const { detectSupportedImageMediaType, resolveReviewedSitePhoto } =
  await import("@/lib/photo-library");

describe("photo library binary validation", () => {
  it("detects supported image signatures rather than trusting upload headers", () => {
    expect(
      detectSupportedImageMediaType(
        Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00]),
      ),
    ).toBe("image/jpeg");
    expect(
      detectSupportedImageMediaType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("image/png");
    expect(
      detectSupportedImageMediaType(
        Buffer.from("RIFF0000WEBP", "ascii"),
      ),
    ).toBe("image/webp");
  });

  it("rejects executable and malformed content", () => {
    expect(detectSupportedImageMediaType(Buffer.from("<script>"))).toBeNull();
  });
});

describe("reviewed photo source resolution", () => {
  const googlePhoto = {
    sourceUrl:
      "https://lh3.googleusercontent.com/sitesv/refreshed-photo-token=w1280",
    sourcePageUrl: "https://restaurant.example",
    usage: "HERO" as const,
  };

  it("preserves a live-fetch 403 when no operator transfer is available", async () => {
    await expect(
      resolveReviewedSitePhoto(googlePhoto, async () => {
        throw new Error("The source image returned HTTP 403");
      }),
    ).rejects.toThrow("The source image returned HTTP 403");
  });

  it("uses transferred Google Sites bytes without making the blocked fetch", async () => {
    const fetchImage = mock(async () => {
      throw new Error("The source image returned HTTP 403");
    });
    const transferred = {
      data: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      mediaType: "image/jpeg",
    };

    await expect(
      resolveReviewedSitePhoto(
        { ...googlePhoto, transferred },
        fetchImage,
      ),
    ).resolves.toEqual(transferred);
    expect(fetchImage).not.toHaveBeenCalled();
  });
});
