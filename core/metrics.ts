// framework/metrics.ts

let coldStartLogged = false;

type LogOptions = {
  tag?: string;
  color?: string;
};

/**
 * Logs cold start time, only once.
 * @param bootStart - Timestamp when the app/process started.
 * @param options - Optional tag and color.
 */
export function logColdStart(bootStart: number, options?: LogOptions) {
  if (coldStartLogged) return;
  coldStartLogged = true;

  const duration = Date.now() - bootStart;
  const label = formatLabel("🚀 Cold Start", options);
  console.log(`${label} took ${duration}ms`);
}

/**
 * Logs request processing duration.
 * @param startTime - Timestamp when the request started.
 * @param url - Request URL.
 * @param options - Optional tag and color.
 */
export function logRequestDuration(startTime: number, url: string, options?: LogOptions) {
  const duration = Date.now() - startTime;
  const label = formatLabel("📡 Request", options);
  console.log(`${label} ${url} took ${duration}ms`);
}

/**
 * Formats a tag with optional color.
 */
function formatLabel(base: string, options?: LogOptions): string {
  const tag = options?.tag ?? base;
  return options?.color ? `\x1b[${options.color}m${tag}\x1b[0m` : tag;
}
