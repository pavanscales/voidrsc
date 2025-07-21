"use server";

// ✅ Fast monotonic timer (Node + Edge safe)
const getNow = (() => {
  if (typeof performance !== "undefined" && performance.now) {
    return () => performance.now();
  }
  try {
    const { performance } = require("perf_hooks");
    return () => performance.now();
  } catch {
    const loadTime = Date.now();
    return () => Date.now() - loadTime;
  }
})();

// ✅ Ultra-fast manual validator (avoid Zod for raw speed)
function validate(data: any): { valid: true; value: ActionInput } | { valid: false; error: string } {
  if (typeof data !== "object" || data === null) return { valid: false, error: "Input must be an object" };
  if (typeof data.id !== "number" || !Number.isInteger(data.id)) return { valid: false, error: "Invalid 'id'" };
  if (typeof data.name !== "string" || data.name.length === 0) return { valid: false, error: "Invalid 'name'" };
  return { valid: true, value: { id: data.id, name: data.name } };
}

// ✅ Trace ID (non-crypto, ultra-fast)
const fastTraceId = () => (Math.random() + 1).toString(36).substring(2, 10);

// ✅ Typed input/output
type ActionInput = { id: number; name: string };
type ActionSuccess = {
  status: "success";
  timestamp: number;
  duration: number;
  result: { processed: ActionInput };
  traceId: string;
};
type ActionError = {
  status: "error";
  timestamp: number;
  duration: number;
  error: string;
  traceId: string;
};
type ActionResponse = ActionSuccess | ActionError;

// ✅ Pure sync simulate
const simulate = (data: ActionInput) => ({ processed: data });

// ✅ Final edge-fast handler
export async function handleAction(data: unknown): Promise<ActionResponse> {
  const start = getNow();
  const traceId = fastTraceId();

  const validation = validate(data);

  const end = getNow();

  if (!validation.valid) {
    return {
      status: "error",
      timestamp: Date.now(),
      duration: +(end - start).toFixed(3),
      error: validation.error,
      traceId,
    };
  }

  const result = simulate(validation.value);
  return {
    status: "success",
    timestamp: Date.now(),
    duration: +(end - start).toFixed(3),
    result,
    traceId,
  };
}
