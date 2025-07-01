// framework/metrics.ts

let coldStartLogged = false;

export function logMetrics(bootStart: number) {
  if (coldStartLogged) return; // log only once
  coldStartLogged = true;

  const coldStartTime = Date.now() - bootStart;
  console.log(`🚀 Cold start took: ${coldStartTime}ms`);
}

export function logRequestTime(startTime: number, url: string) {
  const duration = Date.now() - startTime;
  console.log(`📡 Request for ${url} took ${duration}ms`);
}
