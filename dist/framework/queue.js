// Simple deferred task queue to batch and run async tasks without blocking requests
const taskQueue = [];
let running = false;
// Add a task to the queue, run async without blocking
export function defer(task) {
    taskQueue.push(task);
    runQueue();
}
// Run queued tasks one by one (non-blocking)
async function runQueue() {
    if (running)
        return; // Already running
    running = true;
    while (taskQueue.length) {
        const task = taskQueue.shift();
        try {
            await task();
        }
        catch (e) {
            console.error('Deferred task error:', e);
        }
    }
    running = false;
}
