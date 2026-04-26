"use server";

import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { db } from "@/db";
import { userApiConfig } from "@/db/schema";
import { protectedAction } from "@/lib/safe-action";

/**
 * 检查 URL 是否指向私有/内部网络地址
 * 用于防止 SSRF（服务端请求伪造）攻击
 */
function isPrivateUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol !== "https:") return true;
    if (hostname === "localhost" || hostname === "::1") return true;
    if (hostname === "metadata.google.internal") return true;
    if (hostname.endsWith(".internal")) return true;

    // 检查私有 IP 地址范围
    const ipMatch = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipMatch) {
      const [, a, b] = ipMatch.map(Number);
      if (a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 127) return true;
      if (a === 169 && b === 254) return true;
      if (a === 0) return true;
    }

    return false;
  } catch {
    return true;
  }
}

const apiConfigSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .refine((url) => !isPrivateUrl(url), "Invalid API base URL"),
  apiKey: z.string().min(1),
  model: z.string().optional(),
});

const withApiConfigAction = (name: string) =>
  protectedAction.metadata({ action: `settings.apiConfig.${name}` });

export const getApiConfig = withApiConfigAction("get").action(
  async ({ ctx }) => {
    const config = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);
    return config[0] || null;
  }
);

export const saveApiConfig = withApiConfigAction("save")
  .schema(apiConfigSchema)
  .action(async ({ parsedInput, ctx }) => {
    const existing = await db
      .select()
      .from(userApiConfig)
      .where(eq(userApiConfig.userId, ctx.userId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(userApiConfig)
        .set({
          baseUrl: parsedInput.baseUrl,
          apiKey: parsedInput.apiKey,
          model: parsedInput.model || null,
          updatedAt: new Date(),
        })
        .where(eq(userApiConfig.userId, ctx.userId));
    } else {
      await db.insert(userApiConfig).values({
        id: nanoid(),
        userId: ctx.userId,
        baseUrl: parsedInput.baseUrl,
        apiKey: parsedInput.apiKey,
        model: parsedInput.model || null,
      });
    }

    return { success: true };
  });

export const deleteApiConfig = withApiConfigAction("delete").action(
  async ({ ctx }) => {
    await db.delete(userApiConfig).where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  }
);

export const toggleApiConfig = withApiConfigAction("toggle")
  .schema(z.object({ isActive: z.boolean() }))
  .action(async ({ parsedInput, ctx }) => {
    await db
      .update(userApiConfig)
      .set({
        isActive: parsedInput.isActive,
        updatedAt: new Date(),
      })
      .where(eq(userApiConfig.userId, ctx.userId));
    return { success: true };
  });
