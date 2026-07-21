/**
 * 服务端展示时区解析与用户偏好持久化。
 *
 * 使用方包括 Dashboard Server Components 与 user-auth UOL 操作。部署默认值只读取
 * APP_TIME_ZONE 环境变量；用户偏好存于 user.time_zone，数据库时间本身仍统一为 UTC。
 */
import { db } from "@repo/database";
import { user } from "@repo/database/schema";
import { eq } from "drizzle-orm";

import {
  isValidTimeZone,
  normalizeUserTimeZonePreference,
  resolveDisplayTimeZone,
} from "./index";

export type UserTimeZoneSettings = {
  timeZone: string | null;
  defaultTimeZone: string;
  effectiveTimeZone: string;
};

/**
 * 读取部署环境的默认展示时区。
 *
 * @returns 合法 APP_TIME_ZONE；未配置或非法时返回 UTC；无外部副作用。
 */
export function getAppTimeZone(): string {
  return resolveDisplayTimeZone(null, process.env.APP_TIME_ZONE);
}

/**
 * 读取用户时区偏好及最终生效值。
 *
 * @param userId 当前用户 ID。
 * @returns 用户偏好、env 默认值和最终有效时区；用户不存在时按未设置处理。
 * @throws 数据库查询失败时原样上抛，避免静默掩盖基础设施故障。
 */
export async function getUserTimeZoneSettings(
  userId: string
): Promise<UserTimeZoneSettings> {
  const [row] = await db
    .select({ timeZone: user.timeZone })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  const defaultTimeZone = getAppTimeZone();
  const timeZone = normalizeUserTimeZonePreference(row?.timeZone);
  return {
    timeZone,
    defaultTimeZone,
    effectiveTimeZone: resolveDisplayTimeZone(timeZone, defaultTimeZone),
  };
}

/**
 * 读取用户最终生效的展示时区。
 *
 * @param userId 当前用户 ID。
 * @returns 用户偏好优先、APP_TIME_ZONE 兜底的合法 IANA 时区。
 */
export async function getUserTimeZone(userId: string): Promise<string> {
  return (await getUserTimeZoneSettings(userId)).effectiveTimeZone;
}

/**
 * 保存或清除用户展示时区偏好。
 *
 * @param userId 当前用户 ID。
 * @param timeZone IANA 时区；null 表示恢复继承部署环境。
 * @returns 实际写入的规范化值。
 * @throws 非法时区或数据库更新失败时抛出；不会改写部署环境。
 */
export async function setUserTimeZone(
  userId: string,
  timeZone: string | null
): Promise<string | null> {
  const normalized = timeZone?.trim() || null;
  if (normalized !== null && !isValidTimeZone(normalized)) {
    throw new RangeError("无效的 IANA 时区");
  }
  await db
    .update(user)
    .set({ timeZone: normalized, updatedAt: new Date() })
    .where(eq(user.id, userId));
  return normalized;
}
