import { afterEach, describe, expect, it, vi } from "vitest";

import {
  completeAsyncImageTask,
  createAsyncImageTask,
  postAsyncImageCallback,
  toAsyncImageTaskResponse,
  validateCallbackUrl,
} from "./async-image-tasks";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("external async image tasks", () => {
  it("creates a public processing payload without owner fields", () => {
    const task = createAsyncImageTask({
      userId: "user_1",
      apiKeyId: "key_1",
      model: "gpt-image-2",
      generationIds: ["gen_1"],
    });

    expect(toAsyncImageTaskResponse(task)).toMatchObject({
      id: expect.stringMatching(/^task_/),
      object: "image.generation",
      model: "gpt-image-2",
      status: "processing",
      generation_id: "gen_1",
      generationId: "gen_1",
    });
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("userId");
    expect(toAsyncImageTaskResponse(task)).not.toHaveProperty("apiKeyId");
  });

  it("flattens completed image payload fields onto the task", () => {
    const task = createAsyncImageTask({
      userId: "user_1",
      model: "gpt-image-2",
      generationIds: ["gen_1", "gen_2"],
    });

    const completed = completeAsyncImageTask(task.id, {
      result: {
        created: 123,
        data: [{ url: "https://cdn.example.com/image.png" }],
        credits_consumed: 1.2,
      },
    });

    expect(completed && toAsyncImageTaskResponse(completed)).toMatchObject({
      id: task.id,
      object: "image",
      status: "completed",
      created: 123,
      data: [{ url: "https://cdn.example.com/image.png" }],
      credits_consumed: 1.2,
      generation_ids: ["gen_1", "gen_2"],
    });
  });

  it("rejects private callback URLs", async () => {
    await expect(
      validateCallbackUrl("https://127.0.0.1/callback")
    ).rejects.toThrow("publicly reachable");
  });

  it("rejects http callback URLs to keep results off plaintext", async () => {
    await expect(
      validateCallbackUrl("http://example.com/callback")
    ).rejects.toThrow("https");
  });

  it("posts callback payloads with the callback marker header", async () => {
    const fetchMock = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchMock);
    const task = createAsyncImageTask({ userId: "user_1" });

    await postAsyncImageCallback("https://example.com/callback", task);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ href: "https://example.com/callback" }),
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Tokens-Callback": "true",
        }),
      })
    );
  });

  it("does not follow a callback redirect into a private address", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const task = createAsyncImageTask({ userId: "user_1" });

    await postAsyncImageCallback("https://example.com/callback", task);

    // 第二跳是内网且为 http，逐跳校验拦下，绝不对内网/元数据发起请求。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
