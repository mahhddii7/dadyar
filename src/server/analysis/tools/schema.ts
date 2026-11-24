import { z } from "zod";

const name = z.string().min(1).max(1000);
const scalar = z.union([z.string().max(2000), z.number().finite(), z.boolean(), z.null()]);
export const filterSchema = z.object({
  column: name,
  operator: z.enum(["eq", "neq", "contains", "not_contains", "gt", "gte", "lt", "lte", "in", "is_empty", "not_empty"]),
  value: z.union([scalar, z.array(scalar).max(100)]).optional(),
}).strict();
const metric = z.object({
  name: name, operation: z.enum(["count", "count_values", "distinct_count", "sum", "average", "min", "max"]), column: name.optional(),
}).strict();
const operand = z.union([z.number().finite(), z.object({ column: name }).strict()]);
const derived = z.object({
  name, operation: z.enum(["add", "subtract", "multiply", "divide", "percent", "date_diff_days"]), left: operand, right: operand,
  calendar: z.enum(["jalali", "gregorian"]).optional(),
}).strict();
const query = z.object({
  type: z.literal("query"), datasetIds: z.array(name).min(1).max(30),
  join: z.object({ datasetId: name, leftKey: name, rightKey: name, kind: z.enum(["inner", "left"]) }).strict().optional(),
  derive: z.array(derived).max(8).default([]),
  filters: z.array(filterSchema).max(20).default([]),
  groupBy: z.array(name).max(4).default([]),
  metrics: z.array(metric).max(10).default([]),
  having: z.array(filterSchema).max(10).default([]),
  columns: z.array(name).max(20).optional(),
  sort: z.array(z.object({ column: name, direction: z.enum(["asc", "desc"]) }).strict()).max(4).default([]),
  limit: z.number().int().min(1).max(100).default(30),
}).strict();
export const toolSchema = z.discriminatedUnion("type", [
  query,
  z.object({ type: z.literal("profile"), datasetIds: z.array(name).min(1).max(30), columns: z.array(name).max(20).optional() }).strict(),
  z.object({ type: z.literal("search_documents"), sourceIds: z.array(name).min(1).max(30), query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(12).default(8) }).strict(),
  z.object({ type: z.literal("read_document"), sourceId: name, start: z.number().int().min(1).default(1), count: z.number().int().min(1).max(12).default(8) }).strict(),
  z.object({ type: z.literal("compare"), left: name, right: name, key: name, columns: z.array(name).max(30).default([]) }).strict(),
]);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tools"), calls: z.array(toolSchema).min(1).max(4) }).strict(),
  z.object({ type: z.literal("answer"), answer: z.string().min(1).max(12000), evidenceIds: z.array(z.string()).min(1).max(40) }).strict(),
  z.object({ type: z.literal("clarify"), question: z.string().min(1).max(2000) }).strict(),
]);
export type ToolCall = z.infer<typeof toolSchema>;
export type Query = Extract<ToolCall, { type: "query" }>;
export type Filter = z.infer<typeof filterSchema>;
