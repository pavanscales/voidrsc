// framework/start.ts (Node-compatible RSC with React 19)
import { createServer } from 'node:http';
import { Readable } from 'stream'; // ✅ Works better with TS than 'node:stream/web'
import { router } from './router';
import { renderRSC } from './render';
import { preloadAll } from './preload';
import { logMetrics } from './metrics';
import { profiler } from './profiler';
import { env } from './env';
const bootStart = Date.now();
const { start: profilerStart, stop: profilerStop, trackColdStart } = profiler;
async function main() {
    await preloadAll();
    trackColdStart(bootStart);
    createServer(async (req, res) => {
        const reqStart = Date.now();
        const method = req.method || 'GET';
        const url = new URL(req.url ?? '', `http://${req.headers.host}`);
        try {
            const routeMatch = router.match(url.pathname, method);
            if (!routeMatch) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                return res.end('Not Found');
            }
            profilerStart();
            // ✅ Convert Node req to web Request
            const fetchRequest = new Request(url.toString(), {
                method,
                headers: req.headers,
                // @ts-ignore: Node.js 18+ supports this but TS doesn't know
                duplex: 'half',
                body: method === 'GET' || method === 'HEAD' ? null : Readable.toWeb(req),
            });
            const response = await renderRSC({ route: routeMatch, req: fetchRequest });
            profilerStop();
            if (!response.headers.has('Content-Type')) {
                response.headers.set('Content-Type', 'text/html');
            }
            res.writeHead(response.status, Object.fromEntries(response.headers));
            if (response.body) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    if (value)
                        res.write(decoder.decode(value));
                }
            }
            res.end();
        }
        catch (err) {
            console.error('❌ Server error:', err);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('Internal Server Error');
        }
        finally {
            const duration = Date.now() - reqStart;
            console.log(`📡 [${req.method}] ${req.url} - ${duration}ms`);
        }
    }).listen(env.PORT ?? 3000);
    logMetrics(bootStart);
}
main().catch((err) => {
    console.error('❌ Fatal error during server startup:', err);
    process.exit(1);
});
