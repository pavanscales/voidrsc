// framework/metrics.ts
let coldStartLogged = false;
export function logMetrics(bootStart) {
    if (coldStartLogged)
        return; // log only once
    coldStartLogged = true;
    const coldStartTime = Date.now() - bootStart;
    console.log(`🚀 Cold start took: ${coldStartTime}ms`);
}
export function logRequestTime(startTime, url) {
    const duration = Date.now() - startTime;
    console.log(`📡 Request for ${url} took ${duration}ms`);
}
