// framework/actions.ts

"use server";

/**
 * Simulate an async operation (e.g., DB or cache)
 * Fast 5ms delay to mimic async processing.
 */
async function simulateAsyncOperation(data: any): Promise<any> {
  return new Promise((resolve) => setTimeout(() => resolve({ processedData: data }), 5));
}

/**
 * Simple input validation.
 * Extend this for your real validation needs.
 */
function validateInput(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  // Add your validation logic here (required fields, types, etc.)
  return true;
}

/**
 * Main server action handler — can be used directly as formAction or called from React server components.
 * Throws errors on validation failure to leverage Next.js error boundaries & automatic error handling.
 */
export async function handleAction(data: any) {
  if (!validateInput(data)) {
    throw new Error("Invalid input data");
  }

  const result = await simulateAsyncOperation(data);

  // Return result object — customize as needed.
  return {
    status: "success",
    timestamp: Date.now(),
    result,
  };
}
