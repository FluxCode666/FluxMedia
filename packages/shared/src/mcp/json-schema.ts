/**
 * MCP 工具输入的 Zod 到 JSON Schema 转换器。
 *
 * Zod 4 的公开 JSON Schema 输出会带来额外元数据且不同版本兼容性较弱；这里仅
 * 输出 MCP 所需的结构，同时保留 object、array、enum、union、optional、default
 * 和 nullable 等会影响 agent 调用的语义。
 */

type JsonSchema = Record<string, unknown>;
type ZodDef = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function getDef(schema: unknown): ZodDef | undefined {
  const record = asRecord(schema);
  if (!record) return undefined;
  const zodDef = asRecord(record._zod)?.def;
  return asRecord(zodDef) ?? asRecord(record._def);
}

function schemaFromDef(def: ZodDef | undefined): JsonSchema {
  if (!def) return { type: "object", additionalProperties: true };
  const type = typeof def.type === "string" ? def.type : def.typeName;

  switch (type) {
    case "object":
    case "ZodObject": {
      const shapeValue = def.shape;
      const shape =
        typeof shapeValue === "function"
          ? (shapeValue as () => unknown)()
          : shapeValue;
      const shapeRecord = asRecord(shape);
      if (!shapeRecord) return { type: "object", properties: {} };
      const properties: JsonSchema = {};
      const required: string[] = [];
      for (const [key, field] of Object.entries(shapeRecord)) {
        const fieldDef = getDef(field);
        properties[key] = schemaFromDef(fieldDef);
        const fieldType = fieldDef?.type ?? fieldDef?.typeName;
        if (
          fieldType !== "optional" &&
          fieldType !== "default" &&
          fieldType !== "ZodOptional" &&
          fieldType !== "ZodDefault"
        ) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    case "string":
    case "ZodString":
      return { type: "string" };
    case "number":
    case "ZodNumber":
      return { type: "number" };
    case "integer":
      return { type: "integer" };
    case "boolean":
    case "ZodBoolean":
      return { type: "boolean" };
    case "array":
    case "ZodArray": {
      const element = def.element ?? def.type;
      return {
        type: "array",
        items: element ? schemaFromDef(getDef(element)) : {},
      };
    }
    case "enum":
    case "ZodEnum": {
      const entries = asRecord(def.entries);
      const values = Array.isArray(def.values)
        ? def.values
        : entries
          ? Object.values(entries)
          : [];
      return { type: "string", enum: values };
    }
    case "literal":
    case "ZodLiteral": {
      const values = Array.isArray(def.values) ? def.values : [];
      return values.length === 1 ? { const: values[0] } : { enum: values };
    }
    case "union":
    case "ZodUnion": {
      const options = Array.isArray(def.options)
        ? def.options.map((option) => schemaFromDef(getDef(option)))
        : [];
      return { anyOf: options };
    }
    case "optional":
    case "ZodOptional":
      return schemaFromDef(getDef(def.innerType));
    case "nullable":
    case "ZodNullable":
      return { ...schemaFromDef(getDef(def.innerType)), nullable: true };
    case "default":
    case "ZodDefault": {
      const result = schemaFromDef(getDef(def.innerType));
      const defaultValue = def.defaultValue;
      if (typeof defaultValue === "function") {
        try {
          result.default = (defaultValue as () => unknown)();
        } catch {
          // 默认值计算失败时不影响工具列表生成，输入校验仍由 UOL 负责。
        }
      } else if (defaultValue !== undefined) {
        result.default = defaultValue;
      }
      return result;
    }
    case "date":
    case "ZodDate":
      return { type: "string", format: "date-time" };
    default:
      return { type: "object", additionalProperties: true };
  }
}

/** 将任意 Zod schema 转成 MCP 可用的 JSON Schema。 */
export function zodToMcpJsonSchema(schema: unknown): JsonSchema {
  return schemaFromDef(getDef(schema));
}
