/**
 * PostgreSQL 集成测试的专用数据库 URL 校验器。
 *
 * 职责：只读取调用方指定的测试环境变量，拒绝回退到 DATABASE_URL。
 * 使用方：packages/integration-tests 下所有会连接真实 PostgreSQL 的测试。
 * 关键依赖：WHATWG URL；数据库名必须包含独立的 test 标记。
 */

/**
 * 读取并校验专用 PostgreSQL 测试数据库 URL。
 *
 * @param environmentVariable 需要读取的专用测试环境变量名称。
 * @returns 已去除首尾空白且通过协议与数据库名校验的连接串。
 * @throws 环境变量缺失、URL 非法、协议非 PostgreSQL，或数据库名没有 test 标记时抛错。
 * @sideEffect 读取 process.env；不会读取、修改或记录 DATABASE_URL。
 * @boundary 仅接受 postgres: 或 postgresql:，并要求路径中的数据库名以 test
 *   作为连字符或下划线分隔的独立片段。
 */
export function requireDedicatedTestDatabaseUrl(
  environmentVariable: string
): string {
  const value = process.env[environmentVariable]?.trim();
  if (!value) {
    throw new Error(`${environmentVariable} 未设置；拒绝连接默认 DATABASE_URL`);
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${environmentVariable} 不是有效 PostgreSQL URL`);
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error(`${environmentVariable} 必须使用 PostgreSQL 协议`);
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/(^|[-_])test($|[-_])/iu.test(databaseName)) {
    throw new Error(
      `${environmentVariable} 必须指向名称含 test 标记的专用数据库`
    );
  }
  return value;
}
