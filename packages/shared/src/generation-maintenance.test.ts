import { describe, expect, it } from "vitest";

async function loadHelpers() {
  process.env.DATABASE_URL ||=
    "postgres://test:test@127.0.0.1:5432/gpt2image_test";
  return await import("./generation-maintenance");
}

describe("generation photo retention helpers", () => {
  it("collects primary and additional output storage keys without duplicates", async () => {
    const { collectGenerationImageStorageReferences } = await loadHelpers();

    expect(
      collectGenerationImageStorageReferences({
        storageBucket: "generations",
        storageKey: "user/final.png",
        metadata: {
          outputImage: {
            imageOutputs: [
              { storageKey: "user/draft.png" },
              { storageKey: "user/final.png" },
              { imageUrl: "/api/storage/generations/user/remote.png" },
            ],
          },
        },
      })
    ).toEqual([
      { bucket: "generations", key: "user/final.png" },
      { bucket: "generations", key: "user/draft.png" },
    ]);
  });

  it("strips image references while keeping accounting metadata", async () => {
    const { stripDestroyedGenerationImageReferences } = await loadHelpers();

    const metadata = stripDestroyedGenerationImageReferences(
      {
        outputImage: {
          actualSize: "1024x1024",
          billableImageOutputCount: 1,
          imageOutputs: [
            {
              generationId: "gen-1",
              storageKey: "user/final.png",
              imageUrl: "/api/storage/generations/user/final.png",
              imageFileId: "file-1",
              webImageMessageId: "msg-1",
              size: "1024x1024",
              primary: true,
            },
          ],
        },
        responseOutput: {
          agentEvents: [
            {
              type: "image_generation_call",
              imageUrl: "/api/storage/generations/user/final.png",
              status: "completed",
            },
          ],
        },
      },
      {
        destroyedAt: "2026-05-27T00:00:00.000Z",
        retentionHours: 24,
        storageObjectsDeleted: 1,
      }
    );

    expect(metadata.outputImage).toMatchObject({
      actualSize: "1024x1024",
      billableImageOutputCount: 1,
      photoRetention: {
        destroyedAt: "2026-05-27T00:00:00.000Z",
        retentionHours: 24,
        storageObjectsDeleted: 1,
      },
    });
    expect(
      (
        metadata.outputImage as {
          imageOutputs: Array<Record<string, unknown>>;
        }
      ).imageOutputs[0]
    ).toEqual({
      generationId: "gen-1",
      size: "1024x1024",
      primary: true,
    });
    expect(
      (
        metadata.responseOutput as {
          agentEvents: Array<Record<string, unknown>>;
        }
      ).agentEvents[0]
    ).toEqual({
      type: "image_generation_call",
      status: "completed",
    });
  });
});
