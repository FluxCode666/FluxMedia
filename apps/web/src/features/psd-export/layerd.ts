/**
 * 调用 LayerD(Python/PyTorch)把一张图分解成分层 PSD。
 *
 * 职责:LayerD 是 Python 管线(BiRefNet 抠图 + LaMa 补全 + 分层导出),无法进 Node 进程内跑,
 * 故经子进程调用主机级常驻的 venv + CLI(layerd_export.py),它直接吐 .psd。
 * 使用方:psd-export 编排。路径由 env 配置:LAYERD_PYTHON / LAYERD_SCRIPT / LAYERD_HF_HOME。
 *
 * 性能:CPU ~20-60s/张;由异步导出 + 前端轮询承载。失败模式:未配置 / 子进程非零退出 / 超时。
 */
import { spawn } from "node:child_process";

/** 单次 LayerD 子进程超时(含模型加载 + 推理,留足余量)。 */
const LAYERD_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 跑 LayerD:输入图片路径 → 写出 .psd 到输出路径。
 *
 * @throws 未配置(缺 env)、子进程报错/非零退出、或超时时抛错。
 */
export async function runLayerD(
  inputPath: string,
  outputPath: string
): Promise<void> {
  const python = process.env.LAYERD_PYTHON?.trim();
  const script = process.env.LAYERD_SCRIPT?.trim();
  if (!python || !script) {
    throw new Error("LayerD 未配置(缺 LAYERD_PYTHON / LAYERD_SCRIPT)");
  }
  const env: NodeJS.ProcessEnv = { ...process.env };
  const hfHome = process.env.LAYERD_HF_HOME?.trim();
  if (hfHome) {
    env.HF_HOME = hfHome;
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(python, [script, inputPath, outputPath], { env });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      // 只保留尾部,避免日志被大输出撑爆。
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("LayerD 超时"));
    }, LAYERD_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`LayerD 退出码 ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}
