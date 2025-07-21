"use server";

import { performance } from "node:perf_hooks"; // Safe static import for perf
const getNow = () => performance.now();

let traceCounter = 0;
const fastTraceId = () => (++traceCounter).toString(36);

type ActionInput = { id: number; name: string };
type ActionResponse =
  | { status: "success"; timestamp: number; duration: number; result: { processed: ActionInput }; traceId: string }
  | { status: "error"; timestamp: number; duration: number; error: string; traceId: string };

function validate(data: any): { valid: true; value: ActionInput } | { valid: false; error: string } {
  if (!data || typeof data !== "object") return { valid: false, error: "Input must be object" };
  if (typeof data.id !== "number" || !Number.isInteger(data.id)) return { valid: false, error: "Invalid id" };
  if (typeof data.name !== "string" || !data.name) return { valid: false, error: "Invalid name" };
  return { valid: true, value: { id: data.id, name: data.name } };
}

const simulate = (data: ActionInput) => ({ processed: data });

export function handleAction(data: unknown): ActionResponse {
  const start = getNow();
  const traceId = fastTraceId();

  const validation = validate(data);
  const end = getNow();
  const duration = +(end - start).toFixed(3); // precision fine here

  if (!validation.valid) {
    return { status: "error", timestamp: Date.now(), duration, error: validation.error, traceId };
  }

  const result = simulate(validation.value);
  return { status: "success", timestamp: Date.now(), duration, result, traceId };
}
