let startTime = 0;

function start() {
  startTime = Date.now();
}

function stop(label = '⏱️ Profiler') {
  const duration = Date.now() - startTime;
  const { heapUsed, heapTotal, rss, external } = process.memoryUsage();

  console.log(
    `${label}: ${duration}ms | Heap: ${(heapUsed / 1048576).toFixed(2)} / ${(heapTotal / 1048576).toFixed(2)} MB | RSS: ${(rss / 1048576).toFixed(2)} MB | External: ${(external / 1048576).toFixed(2)} MB`
  );
}

function trackColdStart(bootTime: number, label = '🚀 Cold Start') {
  console.log(`${label}: ${Date.now() - bootTime}ms`);
}

export const profiler = { start, stop, trackColdStart };
