/**
 * 邮件运行时客户端工厂的 DB-free 单元测试。
 *
 * 通过模拟系统设置、Nodemailer 与 Resend，验证凭据轮换、通道切换和发件人
 * 变化无需重启进程即可生效，同时未变化的有效配置仍复用客户端。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  settings: new Map<string, string | boolean>(),
  smtpClients: [] as Array<{
    options: unknown;
    sendMail: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  }>,
  resendClients: [] as Array<{
    apiKey: string;
    send: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("../system-settings", () => ({
  getRuntimeSettingString: vi.fn(async (key: string) => {
    const value = testState.settings.get(key);
    return typeof value === "string" ? value : undefined;
  }),
  getRuntimeSettingBoolean: vi.fn(async (key: string, fallback = false) => {
    const value = testState.settings.get(key);
    return typeof value === "boolean" ? value : fallback;
  }),
}));

vi.mock("nodemailer", () => ({
  createTransport: vi.fn((options: unknown) => {
    const client = {
      options,
      sendMail: vi.fn(async () => ({ messageId: "smtp-message-id" })),
      close: vi.fn(),
    };
    testState.smtpClients.push(client);
    return client;
  }),
}));

vi.mock("resend", () => ({
  Resend: class ResendMock {
    readonly emails: { send: ReturnType<typeof vi.fn> };

    constructor(apiKey: string) {
      const send = vi.fn(async () => ({
        data: { id: "resend-message-id" },
        error: null,
      }));
      this.emails = { send };
      testState.resendClients.push({ apiKey, send });
    }
  },
}));

import {
  getEmailDeliveryClient,
  getEmailProvider,
  getResendClient,
  getSmtpTransporter,
} from "./client";

/**
 * 写入一组完整的 SMTP 测试配置。
 *
 * @param suffix 为每个测试生成互不冲突的模拟凭据。
 */
function configureSmtp(suffix: string): void {
  testState.settings.set("SMTP_HOST", `smtp-${suffix}.example.com`);
  testState.settings.set("SMTP_PORT", "465");
  testState.settings.set("SMTP_SECURE", true);
  testState.settings.set("SMTP_USER", `user-${suffix}`);
  testState.settings.set("SMTP_PASS", `pass-${suffix}`);
}

beforeEach(() => {
  testState.settings.clear();
  testState.smtpClients.length = 0;
  testState.resendClients.length = 0;
});

describe("邮件客户端运行时配置", () => {
  it("SMTP 凭据变化后重建客户端，未变化时复用", async () => {
    configureSmtp("rotation-v1");

    const firstClient = await getSmtpTransporter();
    const reusedClient = await getSmtpTransporter();

    expect(reusedClient).toBe(firstClient);
    expect(testState.smtpClients).toHaveLength(1);

    testState.settings.set("SMTP_PASS", "pass-rotation-v2");
    const rotatedClient = await getSmtpTransporter();

    expect(rotatedClient).not.toBe(firstClient);
    expect(testState.smtpClients).toHaveLength(2);
    expect(testState.smtpClients[0]?.close).toHaveBeenCalledOnce();
  });

  it("Resend API Key 变化后重建客户端，且错误中不泄露凭据", async () => {
    testState.settings.set("RESEND_API_KEY", "resend-key-v1");

    const firstClient = await getResendClient();
    const reusedClient = await getResendClient();

    expect(reusedClient).toBe(firstClient);
    expect(testState.resendClients).toHaveLength(1);

    testState.settings.set("RESEND_API_KEY", "resend-key-v2");
    const rotatedClient = await getResendClient();

    expect(rotatedClient).not.toBe(firstClient);
    expect(testState.resendClients).toHaveLength(2);

    testState.settings.delete("RESEND_API_KEY");
    await expect(getResendClient()).rejects.not.toThrow("resend-key-v2");
  });

  it("运行时切换 provider 后立即选择对应客户端", async () => {
    configureSmtp("provider-switch");
    testState.settings.set("RESEND_API_KEY", "resend-provider-switch");
    testState.settings.set("EMAIL_PROVIDER", "smtp");

    const smtpDelivery = await getEmailDeliveryClient();

    expect(await getEmailProvider()).toBe("smtp");
    expect(smtpDelivery.provider).toBe("smtp");

    testState.settings.set("EMAIL_PROVIDER", "resend");
    const resendDelivery = await getEmailDeliveryClient();

    expect(await getEmailProvider()).toBe("resend");
    expect(resendDelivery.provider).toBe("resend");
  });

  it("EMAIL_FROM 变化后立即进入新的发送快照且不重建客户端", async () => {
    configureSmtp("sender-change");
    testState.settings.set("EMAIL_PROVIDER", "smtp");
    testState.settings.set("EMAIL_FROM", "Sender One <one@example.com>");

    const firstDelivery = await getEmailDeliveryClient();

    testState.settings.set("EMAIL_FROM", "Sender Two <two@example.com>");
    const secondDelivery = await getEmailDeliveryClient();

    expect(firstDelivery.from).toBe("Sender One <one@example.com>");
    expect(secondDelivery.from).toBe("Sender Two <two@example.com>");
    expect(firstDelivery.provider).toBe("smtp");
    expect(secondDelivery.provider).toBe("smtp");
    if (
      firstDelivery.provider === "smtp" &&
      secondDelivery.provider === "smtp"
    ) {
      expect(secondDelivery.transporter).toBe(firstDelivery.transporter);
    }
    expect(testState.smtpClients).toHaveLength(1);
  });
});
