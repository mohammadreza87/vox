import { ConnectionsError } from '../errors';
export type McpSchema = Record<string, unknown>;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const keys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'description', 'title', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
/** Bounded code-owned subset. Unsupported keywords fail closed instead of being silently ignored. */
export function assertMcpSchema(value: unknown, depth = 0): asserts value is McpSchema {
  if (!record(value) || depth > 8 || (depth === 0 && (Buffer.byteLength(JSON.stringify(value)) > 16_000 || value.type !== 'object')) ||
      Object.keys(value).some(key => !keys.has(key)) || !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(value.type))) throw new ConnectionsError(400, 'mcp_schema_unsupported');
  if (value.type === 'object') {
    if (value.properties !== undefined && !record(value.properties)) throw new ConnectionsError(400, 'mcp_schema_unsupported');
    const properties = (value.properties ?? {}) as Record<string, unknown>;
    if (Object.keys(properties).length > 100 || Object.keys(properties).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) throw new ConnectionsError(400, 'mcp_schema_unsupported');
    for (const schema of Object.values(properties)) assertMcpSchema(schema, depth + 1);
    if (value.required !== undefined && (!Array.isArray(value.required) || value.required.length > 100 || value.required.some(key => typeof key !== 'string' || !Object.hasOwn(properties, key)))) throw new ConnectionsError(400, 'mcp_schema_unsupported');
    if (value.additionalProperties !== undefined && typeof value.additionalProperties !== 'boolean') throw new ConnectionsError(400, 'mcp_schema_unsupported');
  }
  if (value.type === 'array') assertMcpSchema(value.items, depth + 1);
  for (const name of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems'])
    if (value[name] !== undefined && (typeof value[name] !== 'number' || !Number.isFinite(value[name]) || !Number.isSafeInteger(value[name]))) throw new ConnectionsError(400, 'mcp_schema_unsupported');
  for (const name of ['description', 'title']) if (value[name] !== undefined && (typeof value[name] !== 'string' || value[name].length > 2000)) throw new ConnectionsError(400, 'mcp_schema_unsupported');
  if (value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.length || value.enum.length > 100 || value.enum.some(record))) throw new ConnectionsError(400, 'mcp_schema_unsupported');
}
export function validateMcpValue(schema: McpSchema, value: unknown, depth = 0): boolean {
  if (depth > 9 || (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) ||
      (Array.isArray(schema.enum) && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value)))) return false;
  switch (schema.type) {
    case 'object': {
      if (!record(value) || Object.keys(value).length > 100 || Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key))) return false;
      const props = (schema.properties ?? {}) as Record<string, McpSchema>;
      if ((schema.required as string[] | undefined)?.some(key => !Object.hasOwn(value, key))) return false;
      return Object.entries(value).every(([key, item]) => Object.hasOwn(props, key) ? validateMcpValue(props[key], item, depth + 1) : schema.additionalProperties !== false);
    }
    case 'array': return Array.isArray(value) && value.length <= Math.min(Number(schema.maxItems ?? 1000), 1000) && value.length >= Number(schema.minItems ?? 0) && value.every(item => validateMcpValue(schema.items as McpSchema, item, depth + 1));
    case 'string': return typeof value === 'string' && value.length <= Math.min(Number(schema.maxLength ?? 64000), 64000) && value.length >= Number(schema.minLength ?? 0);
    case 'integer': case 'number': return typeof value === 'number' && Number.isFinite(value) && (schema.type !== 'integer' || Number.isSafeInteger(value)) && value >= Number(schema.minimum ?? -Infinity) && value <= Number(schema.maximum ?? Infinity);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return false;
  }
}
