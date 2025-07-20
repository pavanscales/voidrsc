// Minimal deferred task queue for async batching without blocking

const queue: (() => Promise<void>)[] = [];
let flushing = false;

export function defer(task: () => Promise<void>) {
  queue.push(task);
  if (!flushing) flush();
}

async function flush() {
  flushing = true;

  for (let i = 0; i < queue.length; i++) {
    try {
      await queue[i]();
    } catch (err) {
      console.error('Deferred task error:', err);
    }
  }

  queue.length = 0; // Clear in-place without shift() GC churn
  flushing = false;
}
