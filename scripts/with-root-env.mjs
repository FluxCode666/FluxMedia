/**
 * 从仓库根目录加载 .env 后启动子进程。
 *
 * 供根 package.json 及各工作区启动脚本复用，确保 pnpm 改变 cwd 时仍使用
 * 同一份本地运行配置。使用 dotenv 解析 .env，系统环境变量优先于 .env。
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..");
const rootEnvPath = resolve(projectRoot, ".env");
const [command, ...commandArguments] = process.argv.slice(2);

/**
 * 将根目录 .env 合并到当前进程环境变量中。
 *
 * @returns 环境文件缺失或成功加载时为 true；解析失败时为 false。
 * @sideEffects 仅填充当前进程中尚未定义的环境变量，不覆盖外部注入的配置。
 */
function loadRootEnvironment() {
  if (!existsSync(rootEnvPath)) {
    return true;
  }

  const result = dotenv.config({ path: rootEnvPath, quiet: true });
  if (!result.error) {
    return true;
  }

  console.error("无法加载项目根目录 .env", result.error);
  return false;
}

/**
 * 使用根目录环境变量执行传入的 Node.js 命令。
 *
 * @returns 无返回值；子进程退出码会透传给当前 pnpm 命令。
 * @sideEffects 启动子进程并继承其标准输入、输出和错误输出。
 * @throws 子进程无法创建时设置失败退出码并输出错误。
 */
function runCommand() {
  if (!loadRootEnvironment()) {
    process.exitCode = 1;
    return;
  }

  if (!command) {
    console.error("缺少要执行的 Node.js 命令");
    process.exitCode = 1;
    return;
  }

  const child = spawn(
    process.execPath,
    [command, ...commandArguments],
    {
      cwd: process.cwd(),
      stdio: "inherit",
    }
  );

  child.once("error", (error) => {
    console.error("无法启动子进程", error);
    process.exitCode = 1;
  });
  child.once("exit", (code) => {
    process.exitCode = code ?? 1;
  });
}

runCommand();
