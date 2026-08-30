import { describe, expect, it, mock } from "bun:test";
import sharp from "sharp";
import { loadPublicHeroImageDataUrl } from "@/lib/opengraph-hero";

const opengraphRoute = await Bun.file(
  new URL("../app/preview/[slug]/opengraph-image.tsx", import.meta.url),
).text();

describe("Open Graph remote hero boundary", () => {
  it("uses the patched Sharp/libvips runtime", async () => {
    const sharpPackage = await Bun.file(
      new URL("../../node_modules/sharp/package.json", import.meta.url),
    ).json();

    expect(sharpPackage.version).toBe("0.35.4");
    expect(sharp.versions.vips).toBe("8.18.6");
  });

  it("routes the metadata image through the bounded public-image fetcher", async () => {
    const validPng = new Uint8Array(
      await Bun.file(
        new URL(
          "../../public/brand/cornershopdev/favicon-32.png",
          import.meta.url,
        ),
      ).arrayBuffer(),
    );
    const fetchImage = mock(async () => ({
      data: validPng,
      mediaType: "image/png",
    }));

    const result = await loadPublicHeroImageDataUrl(
      "https://images.example/hero.png",
      fetchImage,
    );
    expect(result).not.toBeNull();
    expect(result!).toStartWith("data:image/jpeg;base64,");
    const normalized = Buffer.from(result!.split(",")[1]!, "base64");
    await expect(sharp(normalized).metadata()).resolves.toMatchObject({
      format: "jpeg",
      width: 1_200,
      height: 630,
    });
    expect(fetchImage).toHaveBeenCalledTimes(1);
    expect(opengraphRoute).toContain("loadPublicHeroImageDataUrl");
    expect(opengraphRoute).not.toMatch(/\bfetch\s*\(/);
  });

  it.each([
    ["private IP", "Private network addresses are not supported"],
    [
      "redirect to private IP",
      "Private network addresses are not supported after redirect",
    ],
    ["DNS failure", "The website could not be resolved"],
    ["timeout", "The operation was aborted due to timeout"],
  ])("falls back without an unrestricted retry after %s rejection", async (_case, message) => {
    const fetchImage = mock(async () => {
      throw new Error(message);
    });

    await expect(
      loadPublicHeroImageDataUrl("https://images.example/hero.png", fetchImage),
    ).resolves.toBeNull();
    expect(fetchImage).toHaveBeenCalledTimes(1);
  });

  it("rejects a private literal through the real public-image boundary", async () => {
    await expect(
      loadPublicHeroImageDataUrl("http://127.0.0.1/private.png"),
    ).resolves.toBeNull();
  });

  it("rejects oversized, empty, and unsupported image responses", async () => {
    const oversized = new Uint8Array(4 * 1024 * 1024 + 1);
    await expect(
      loadPublicHeroImageDataUrl(
        "https://images.example/large.png",
        async () => ({ data: oversized, mediaType: "image/png" }),
      ),
    ).resolves.toBeNull();
    await expect(
      loadPublicHeroImageDataUrl(
        "https://images.example/empty.png",
        async () => ({ data: new Uint8Array(), mediaType: "image/png" }),
      ),
    ).resolves.toBeNull();
    await expect(
      loadPublicHeroImageDataUrl(
        "https://images.example/vector.svg",
        async () => ({
          data: new TextEncoder().encode("<svg></svg>"),
          mediaType: "image/svg+xml",
        }),
      ),
    ).resolves.toBeNull();
  });

  it("falls back when a PNG content type carries malformed bytes", async () => {
    await expect(
      loadPublicHeroImageDataUrl(
        "https://images.example/malformed.png",
        async () => ({
          data: new TextEncoder().encode("not actually a PNG"),
          mediaType: "image/png",
        }),
      ),
    ).resolves.toBeNull();
  });
});
