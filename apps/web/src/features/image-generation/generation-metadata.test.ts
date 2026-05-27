import { describe, expect, it } from "vitest";
import {
  buildInputImagesMetadata,
  extractGenerationReferenceImages,
} from "./generation-metadata";

describe("generation metadata image references", () => {
  it("stores uploaded input images with stable storage URLs", () => {
    const metadata = buildInputImagesMetadata([
      {
        data: Buffer.from("image"),
        name: "reference.png",
        type: "image/png",
        url: "https://signed.example/reference.png",
        storageBucket: "generations",
        storageKey: "user/requests/reference.png",
      },
    ]);

    expect(metadata).toEqual({
      inputImages: {
        count: 1,
        images: [
          {
            id: "input-1",
            imageUrl: "/api/storage/generations/user/requests/reference.png",
            storageBucket: "generations",
            storageKey: "user/requests/reference.png",
            name: "reference.png",
            type: "image/png",
            sizeBytes: 5,
            source: "upload",
            role: "reference",
            index: 0,
          },
        ],
      },
    });
  });

  it("extracts reference images from metadata and prefers stored object URLs", () => {
    expect(
      extractGenerationReferenceImages({
        inputImages: {
          images: [
            {
              id: "input-1",
              imageUrl: "https://signed.example/old.png",
              storageBucket: "generations",
              storageKey: "user/requests/reference.png",
              name: "reference.png",
              type: "image/png",
              sizeBytes: 123,
              source: "upload",
              role: "reference",
              index: 0,
            },
          ],
        },
      })
    ).toEqual([
      {
        id: "input-1",
        imageUrl: "/api/storage/generations/user/requests/reference.png",
        storageBucket: "generations",
        storageKey: "user/requests/reference.png",
        name: "reference.png",
        type: "image/png",
        sizeBytes: 123,
        source: "upload",
        role: "reference",
        index: 0,
      },
    ]);
  });
});
