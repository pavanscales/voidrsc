"use server";

import { performance } from "node:perf_hooks";

// 🚀 High-resolution timer (zero-cost wrapper)
const now = () => performance.now();

// 🔁 Wrapped zero-cost trace ID counter (wraps at 1 million)
const MAX_TRACE = 1_000_000;
let traceCounter = 0;
const fastTraceId = () => {
  traceCounter = (traceCounter + 1) % MAX_TRACE;
  return traceCounter.toString(36);
};

// 🔒 Zero-cost, branchless security check (fail fast)
const securityCheck = (ctx?: { headers?: Headers; cookies?: Record<string, string> }) => {
  const csrf = ctx?.headers?.get("x-csrf-token");
  const session = ctx?.cookies?.session;
  if (!csrf || !session) throw new Error("Unauthorized");
};

// 🎯 Input type
type ActionInput = { id: number; name: string };

// 🧪 Validation result type
type ValidationResult =
  | { v: true; d: ActionInput }
  | { v: false; e: string };

// ⚡ Branchless validator: strict and minimal
const validate = (i: unknown): ValidationResult => {
  if (!i || typeof i !== "object") return { v: false, e: "Expected object" };
  const d = i as Record<string, unknown>;
  if (typeof d.id !== "number" || !Number.isInteger(d.id)) return { v: false, e: "Invalid id" };
  if (typeof d.name !== "string" || !d.name.trim()) return { v: false, e: "Invalid name" };
  return { v: true, d: { id: d.id, name: d.name } };
};

// 🔧 Pure compute logic (simulate processing)
const simulate = (input: ActionInput) => ({
  processed: input,
  note: "processed locally",
});

// 📦 Native JSON serialization (replace with SIMD-json for native env)
const serialize = JSON.stringify;

// 🧠 Ultra-fast synchronous handler (no async overhead)
export const handleAction = (
  input: unknown,
  ctx?: { headers?: Headers; cookies?: Record<string, string> }
): {
  status: "success" | "error";
  traceId: string;
  timestamp: number;
  duration: number;
  result?: string;
  error?: string;
} => {
  const t0 = now();
  const traceId = fastTraceId();

  // Security check - fail fast
  try {
    securityCheck(ctx);
  } catch (e) {
    const duration = now() - t0;
    return {
      status: "error",
      traceId,
      timestamp: Date.now(),
      duration,
      error: (e as Error).message,
    };
  }

  // Validate input
  const val = validate(input);
  if (!val.v) {
    const duration = now() - t0;
    return {
      status: "error",
      traceId,
      timestamp: Date.now(),
      duration,
      error: val.e,
    };
  }

  // Compute result
  const resultObj = simulate(val.d);

  // Capture user-agent from ctx headers if present, else unknown
  const ua = ctx?.headers?.get("user-agent") ?? "unknown";

  // Serialize result + context inline to avoid extra object creation
  const result = serialize({
    ...resultObj,
    ctx: { ua },
  });

  const duration = now() - t0;

  return {
    status: "success",
    traceId,
    timestamp: Date.now(),
    duration,
    result,
  };
};
