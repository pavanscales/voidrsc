let startTime = 0;
function start() {
    startTime = Date.now();
}
function stop() {
    const duration = Date.now() - startTime;
    const mem = process.memoryUsage();
    const heapUsedMB = (mem.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (mem.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (mem.rss / 1024 / 1024).toFixed(2);
    const externalMB = (mem.external / 1024 / 1024).toFixed(2);
    console.log(`⏱️ Profiler: ${duration}ms | Heap Used: ${heapUsedMB} MB / ${heapTotalMB} MB | RSS: ${rssMB} MB | External: ${externalMB} MB`);
}
function trackColdStart(startTimestamp) {
    const duration = Date.now() - startTimestamp;
    console.log(`🚀 Cold Start Time: ${duration}ms`);
}
export const profiler = { start, stop, trackColdStart };
