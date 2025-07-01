import { renderToReadableStream } from './rsc';
import { cache } from './cache';
import { profiler } from './profiler';
const encoder = new TextEncoder();
// Pre-encode shell once, keep as Uint8Array constants
const shellStart = encoder.encode('<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    '<title>Fast RSC App</title><style>body{margin:0;font-family:system-ui,sans-serif}</style>' +
    '</head><body><div id="root">');
const shellEnd = encoder.encode('</div><script src="/client-hydrate.js" async></script></body></html>');
// Async generator: yield shell + stream chunks + shell end
async function* combinedStreamGenerator(stream) {
    yield shellStart;
    const reader = stream.getReader();
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            yield value;
        }
    }
    finally {
        reader.releaseLock();
    }
    yield shellEnd;
}
// Return Response wrapping streaming HTML (shell + RSC)
function htmlShell(stream) {
    const combinedStream = new ReadableStream({
        async start(controller) {
            try {
                for await (const chunk of combinedStreamGenerator(stream)) {
                    controller.enqueue(chunk);
                }
                controller.close();
            }
            catch (error) {
                // In production, consider logging the error somewhere async here
                controller.error(error);
            }
        }
    });
    return new Response(combinedStream, {
        headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Cache aggressively for CDN on GET, no cache for others
            'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
            // Add security headers for production (CSP, XSS, HSTS)
            // 'Content-Security-Policy': "default-src 'self'; script-src 'self'",
            // 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
        },
    });
}
// Main optimized renderRSC function with caching and profiling
export async function renderRSC({ route, req, }) {
    profiler.start();
    try {
        const url = new URL(req.url);
        // Key cache by method and pathname only to avoid cache explosion
        const cacheKey = `${req.method}:${url.pathname}`;
        // Serve from cache ASAP
        const cached = cache.get(cacheKey);
        if (cached) {
            profiler.stop();
            // Clone to avoid streaming issues with reused responses
            return cached.clone();
        }
        // Run route handler to get React element to stream
        const element = await route.handler(req, {});
        // Stream render to readable stream from React Server Components
        const rscStream = await renderToReadableStream(element);
        // Wrap with fast streaming HTML shell
        const response = htmlShell(rscStream);
        // Cache the response clone for next requests
        cache.set(cacheKey, response.clone());
        profiler.stop();
        return response;
    }
    catch (error) {
        profiler.stop();
        const errorHTML = `<!DOCTYPE html><html><body><h1>Server Error</h1><pre>${escapeHtml(error.message)}</pre></body></html>`;
        return new Response(errorHTML, {
            status: 500,
            headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
    }
}
// Escape HTML to avoid XSS in error messages
function escapeHtml(str) {
    return str.replace(/[&<>"']/g, (char) => {
        switch (char) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return char;
        }
    });
}
