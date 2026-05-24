import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@repo/shared/system-settings", () => ({
  getRuntimeSettingBoolean: vi.fn(async () => false),
  getRuntimeSettingNumber: vi.fn(async (_key: string, fallback: number) => fallback),
  getRuntimeSettingString: vi.fn(async () => ""),
}));

import type { ApiConfig } from "./types";

const encoder = new TextEncoder();

function sseBlock(event: string, data: Record<string, unknown>) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

describe("Responses streaming parser", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses stream=true Responses bodies incrementally even when content-type is wrong", async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL || "postgresql://test:test@127.0.0.1:5432/test";
    const { generateChatImage } = await import("./service");
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(nextController) {
        controller = nextController;
      },
    });
    const fetchMock = vi.fn(async () => {
      return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    let resolveFirstDelta!: () => void;
    const firstDelta = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve;
    });
    const deltas: string[] = [];
    const config: ApiConfig = {
      baseUrl: "https://api.example.test/v1",
      apiKey: "test-key",
    };

    const resultPromise = generateChatImage(
      config,
      {
        prompt: "hello",
        model: "gpt-5.4",
        stream: true,
      },
      {
        onTextDelta: (delta) => {
          deltas.push(delta);
          resolveFirstDelta();
        },
      }
    );

    controller?.enqueue(
      encoder.encode(
        sseBlock("response.output_text.delta", {
          type: "response.output_text.delta",
          delta: "hello",
        })
      )
    );

    await firstDelta;
    expect(deltas).toEqual(["hello"]);

    controller?.enqueue(
      encoder.encode(
        sseBlock("response.completed", {
          type: "response.completed",
          response: { id: "resp_test", output: [] },
        })
      )
    );
    controller?.close();

    await expect(resultPromise).resolves.toMatchObject({
      responseText: "hello",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/v1/responses",
      expect.objectContaining({
        body: expect.stringContaining('"stream":true'),
      })
    );
  });
});
