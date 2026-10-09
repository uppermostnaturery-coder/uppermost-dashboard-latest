import { z } from "zod";
export const featureFields = {
  order_count: "number", realized_spend_paise: "number", average_order_value_paise: "number",
  last_order_at: "date", first_order_at: "date", last_order_total_paise: "number",
  ordered_product_codes: "array", ordered_skus: "array", active_subscription_count: "number",
  subscription_status: "string", next_subscription_charge_at: "date", last_payment_status: "string", last_shipment_status: "string",
  discount_order_ratio: "number", last_product_view: "string", last_seen_at: "date", last_cart_activity_at: "date",
  cart_value_paise: "number", cart_checkout_started: "boolean", cart_converted: "boolean",
  email_marketing_allowed: "boolean", whatsapp_marketing_allowed: "boolean", sms_marketing_allowed: "boolean",
} as const;
export type Field = keyof typeof featureFields;
export type Condition = { all: Condition[] } | { any: Condition[] } | { none: Condition[] } | { field: Field; op: string; value?: unknown };
const operators = ["eq","neq","gt","gte","lt","lte","in","not_in","contains","exists","before","after","days_since_gte","days_since_lte"];
export function parseCondition(input: unknown): Condition {
  let count = 0;
  function parse(value: unknown, depth: number): Condition {
    if (++count > 50 || depth > 5) throw new Error("RULE_COMPLEXITY_LIMIT");
    const v = z.record(z.string(), z.unknown()).parse(value);
    for (const group of ["all","any","none"] as const) if (group in v) {
      if (Object.keys(v).length !== 1 || !Array.isArray(v[group]) || v[group].length > 20) throw new Error("INVALID_RULE_GROUP");
      return { [group]: v[group].map((c) => parse(c, depth + 1)) } as Condition;
    }
    if (Object.keys(v).some((k) => !["field","op","value"].includes(k)) || !(String(v.field) in featureFields) || !operators.includes(String(v.op))) throw new Error("INVALID_RULE_FIELD");
    const type = featureFields[v.field as Field]; const op = String(v.op);
    const scalar = (x: unknown) => type === "number" ? typeof x === "number" && Number.isFinite(x) : type === "boolean" ? typeof x === "boolean" : typeof x === "string" && x.length <= 128 && (type !== "date" || Number.isFinite(Date.parse(x)));
    const valid = op === "exists" ? v.value === undefined || typeof v.value === "boolean" : op.startsWith("days_since_") ? type === "date" && typeof v.value === "number" && v.value >= 0 && v.value <= 3650 : ["in","not_in"].includes(op) ? Array.isArray(v.value) && v.value.length > 0 && v.value.length <= 20 && v.value.every(scalar) : op === "contains" ? type === "array" && typeof v.value === "string" && v.value.length <= 128 : scalar(v.value);
    if (!valid || (["before","after"].includes(op) && type !== "date") || (["gt","gte","lt","lte"].includes(op) && !["date","number"].includes(type))) throw new Error("INVALID_RULE_VALUE");
    return { field: v.field as Field, op, value: v.value };
  }
  return parse(input, 0);
}
export function evaluateCondition(c: Condition, feature: Record<string, unknown>, now = new Date()): boolean {
  if ("all" in c) return c.all.every((v) => evaluateCondition(v, feature, now));
  if ("any" in c) return c.any.some((v) => evaluateCondition(v, feature, now));
  if ("none" in c) return !c.none.some((v) => evaluateCondition(v, feature, now));
  const a = feature[c.field]; const b = c.value;
  if (c.op === "exists") return (a !== null && a !== undefined) === (b !== false);
  if (a === null || a === undefined) return false;
  switch(c.op) {
    case "eq": return a === b; case "neq": return a !== b;
    case "in": return (b as unknown[]).includes(a); case "not_in": return !(b as unknown[]).includes(a);
    case "contains": return Array.isArray(a) && a.includes(b);
    case "days_since_gte": return Date.parse(String(a)) <= now.getTime() - Number(b)*86400000;
    case "days_since_lte": return Date.parse(String(a)) >= now.getTime() - Number(b)*86400000;
    case "before": case "lt": return typeof a === "number" ? a < Number(b) : String(a) < String(b);
    case "after": case "gt": return typeof a === "number" ? a > Number(b) : String(a) > String(b);
    case "gte": return typeof a === "number" ? a >= Number(b) : String(a) >= String(b);
    case "lte": return typeof a === "number" ? a <= Number(b) : String(a) <= String(b);
    default: return false;
  }
}
export function compileCondition(c: Condition, now = new Date()): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const compile = (v: Condition): string => {
    for (const group of ["all","any","none"] as const) if (group in v) {
      const list = (v as Record<string, Condition[]>)[group];
      const expression = list.length ? list.map(compile).map((s) => `(${s})`).join(group === "all" ? " AND " : " OR ") : group === "all" ? "TRUE" : "FALSE";
      return group === "none" ? `NOT (${expression})` : expression;
    }
    const leaf = v as Extract<Condition, { field: Field }>; const field = `"${leaf.field}"`;
    if (leaf.op === "exists") return `${field} IS ${leaf.value === false ? "" : "NOT "}NULL`;
    if (leaf.op.startsWith("days_since")) return `${field} ${leaf.op.endsWith("gte") ? "<=" : ">="} ${bind(new Date(now.getTime()-Number(leaf.value)*86400000).toISOString())}`;
    if (["in","not_in"].includes(leaf.op)) return `${field} ${leaf.op === "in" ? "= ANY" : "<> ALL"}(${bind(leaf.value)})`;
    if (leaf.op === "contains") return `${field} @> ${bind([leaf.value])}`;
    const ops: Record<string,string> = { eq:"=",neq:"<>",gt:">",gte:">=",lt:"<",lte:"<=",before:"<",after:">" };
    return `${field} ${ops[leaf.op]} ${bind(leaf.value)}`;
  };
  return { sql: compile(parseCondition(c)), params };
}
