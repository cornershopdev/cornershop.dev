import { describe, expect, it, mock } from "bun:test";

let bodyFinished = false;
let bodyLocked = false;
let closeFinished = false;
let closeObservedFinishedBody = false;
type Lookup = (
  host: string,
  options: { all?: boolean },
  callback: (
    error: Error | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number,
  ) => void,
) => void;
let pinnedLookup: Lookup | null = null;

class TestAgent {
  destroyed = false;

  constructor(options: { connect: { lookup: Lookup } }) {
    pinnedLookup = options.connect.lookup;
  }

  async close() {
    closeObservedFinishedBody = bodyFinished;
    await Promise.resolve();
    closeFinished = true;
  }

  async destroy() {
    this.destroyed = true;
  }
}

mock.module("node:dns/promises", () => ({
  resolve4: async () => ["93.184.216.34"],
  resolve6: async () => [],
}));

mock.module("undici", () => ({
  Agent: TestAgent,
  Headers: globalThis.Headers,
  fetch: async () => {
    let sent = false;
    const body = {
      get locked() {
        return bodyLocked;
      },
      getReader() {
        bodyLocked = true;
        return {
          async read() {
            if (!sent) {
              sent = true;
              return {
                done: false as const,
                value: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
              };
            }
            bodyFinished = true;
            return { done: true as const, value: undefined };
          },
          async cancel() {
            bodyFinished = true;
          },
          releaseLock() {
            bodyLocked = false;
          },
        };
      },
      async cancel() {
        bodyFinished = true;
      },
    };
    return {
      body,
      headers: new Headers({ "content-type": "image/jpeg" }),
      ok: true,
      status: 200,
    };
  },
}));

const { fetchPublicImage } = await import("@/lib/importer");

function getPinnedLookup(): Lookup {
  if (!pinnedLookup) throw new Error("The pinned lookup was not configured");
  return pinnedLookup;
}

describe("public response lifecycle", () => {
  it("finishes the response body before awaiting dispatcher shutdown", async () => {
    await expect(
      fetchPublicImage("https://restaurant.example/photo.jpg"),
    ).resolves.toMatchObject({
      data: Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]),
      mediaType: "image/jpeg",
    });
    expect(closeObservedFinishedBody).toBe(true);
    expect(closeFinished).toBe(true);
  });

  it("returns the pinned address in Node's all-address lookup shape", async () => {
    const address = await new Promise<
      string | Array<{ address: string; family: number }>
    >((resolve, reject) => {
      getPinnedLookup()(
        "restaurant.example",
        { all: true },
        (error, result) => {
          if (error) reject(error);
          else resolve(result);
        },
      );
    });
    expect(address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });
});
