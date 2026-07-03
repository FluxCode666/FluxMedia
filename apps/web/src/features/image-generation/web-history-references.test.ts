import { describe, expect, it, vi } from "vitest";

import {
  downloadWebHistoryImageReference,
  getRecentWebHistoryImageReferences,
} from "./web-history-references";
import type { ChatHistoryMessage } from "./types";

// 守护审计 S-H2：客户端提交的历史 storage 引用越权/IDOR 防护。
describe("downloadWebHistoryImageReference storage 引用校验", () => {
  const baseRef = (imageUrl: string) => ({
    imageUrl,
    fileName: "web-history-assistant-1",
    sourceId: imageUrl,
  });

  it("拒绝非 generations 桶（封堵跨桶任意读）", async () => {
    const readStorageImage = vi.fn();
    await expect(
      downloadWebHistoryImageReference(
        baseRef("/api/storage/avatars/victim/secret.png"),
        { readStorageImage }
      )
    ).rejects.toThrow(/bucket is not allowed/);
    expect(readStorageImage).not.toHaveBeenCalled();
  });

  it("拒绝路径穿越的 key", async () => {
    const readStorageImage = vi.fn();
    await expect(
      downloadWebHistoryImageReference(
        baseRef("/api/storage/generations/..%2f..%2fsecret/key.png"),
        { readStorageImage }
      )
    ).rejects.toThrow(/key is not allowed/);
    expect(readStorageImage).not.toHaveBeenCalled();
  });

  it("允许 generations 桶下的合法 key", async () => {
    const readStorageImage = vi
      .fn()
      .mockResolvedValue(Buffer.from("img-bytes"));
    const file = await downloadWebHistoryImageReference(
      baseRef("/api/storage/generations/user-123/abc123.png"),
      { readStorageImage }
    );
    expect(readStorageImage).toHaveBeenCalledTimes(1);
    expect(file.type).toBe("image/png");
    expect(file.data.toString()).toBe("img-bytes");
  });
});

describe("getRecentWebHistoryImageReferences（换号兜底:含用户上传图）", () => {
  const userMsg = (imageUrls: string[]): ChatHistoryMessage => ({
    role: "user",
    text: "这是什么",
    imageUrls,
  });
  const assistantMsg = (imageUrl?: string): ChatHistoryMessage => ({
    role: "assistant",
    text: "",
    variants: imageUrl ? [{ imageUrl }] : [{ text: "这是一个苹果" }],
    activeVariant: 0,
  });

  it("上一轮纯文字时,仍能取回用户上传的参考图(先问后变色场景)", () => {
    const history = [
      userMsg(["/api/storage/generations/u/apple.png"]),
      assistantMsg(), // 纯文字回复,无 assistant 图
    ];
    const refs = getRecentWebHistoryImageReferences(history);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.imageUrl).toBe("/api/storage/generations/u/apple.png");
  });

  it("最新在前、去重、限量,并接受 data:image URL", () => {
    const history = [
      userMsg(["data:image/png;base64,AAAA"]),
      assistantMsg("https://cdn.example.com/gen1.png"),
      userMsg(["https://cdn.example.com/gen1.png"]), // 与上重复,去重
    ];
    const refs = getRecentWebHistoryImageReferences(history, { limit: 5 });
    expect(refs.map((r) => r.imageUrl)).toEqual([
      "https://cdn.example.com/gen1.png",
      "data:image/png;base64,AAAA",
    ]);
  });

  it("解码 data:image URL 为二进制", async () => {
    const b64 = Buffer.from("hello-png").toString("base64");
    const file = await downloadWebHistoryImageReference({
      imageUrl: `data:image/png;base64,${b64}`,
      fileName: "web-history-user-1",
      sourceId: "x",
    });
    expect(file.type).toBe("image/png");
    expect(file.data.toString()).toBe("hello-png");
    expect(file.name).toBe("web-history-user-1.png");
  });
});
