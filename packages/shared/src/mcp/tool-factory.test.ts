import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";

import { bindExecute, clearRegistry, defineOperation } from "../uol/registry";
import type { Principal } from "../uol/principal";
import type { AccessRequirement, OperationDefinition } from "../uol/types";
import { buildAdminMcpTools } from "./tool-factory";
import { buildUserMcpTools } from "./user-tool-factory";

const apiKeyPrincipal = {
  type: "apiKey",
  userId: "user-1",
  apiKeyId: "key-1",
  plan: "pro",
  relayOnly: false,
} satisfies Principal;

const adminPrincipal = {
  type: "user",
  userId: "admin-1",
  role: "super_admin",
} satisfies Principal;

function registerOperation(
  overrides: Partial<OperationDefinition> & {
    name: string;
    access: AccessRequirement;
  },
) {
  return defineOperation({
    name: overrides.name,
    domain: overrides.domain ?? "image-generation",
    title: overrides.title ?? "Test Operation",
    description: overrides.description ?? "A test operation",
    input: overrides.input ?? z.object({}),
    output: overrides.output ?? z.object({ ok: z.boolean() }),
    access: overrides.access,
    readOnly: overrides.readOnly ?? false,
    destructive: overrides.destructive ?? false,
    idempotency: overrides.idempotency ?? { kind: "natural" },
    sideEffects: overrides.sideEffects ?? [],
    execute:
      overrides.execute ??
      (async () => {
        throw new Error(`Not yet wired: ${overrides.name}`);
      }),
  });
}

describe("MCP tool factories", () => {
  beforeEach(() => {
    clearRegistry();
    delete process.env.MCP_DENIED_OPS;
    delete process.env.MCP_READ_ONLY;
  });

  it("hides user tools until their UOL operation is bound", () => {
    registerOperation({
      name: "image.generate",
      access: { kind: "protected" },
    });

    expect(buildUserMcpTools(apiKeyPrincipal)).toHaveLength(0);

    bindExecute("image.generate", async () => ({ ok: true }));

    expect(buildUserMcpTools(apiKeyPrincipal).map((tool) => tool.name)).toEqual([
      "image.generate",
    ]);
  });

  it("hides admin tools until their UOL operation is bound", () => {
    registerOperation({
      name: "pool.getAdminPool",
      domain: "image-backend-pool",
      access: { kind: "imageBackendPoolViewer" },
      readOnly: true,
    });

    expect(buildAdminMcpTools(adminPrincipal)).toHaveLength(0);

    bindExecute("pool.getAdminPool", async () => ({ ok: true }));

    expect(buildAdminMcpTools(adminPrincipal).map((tool) => tool.name)).toEqual([
      "pool_getAdminPool",
    ]);
  });
});
