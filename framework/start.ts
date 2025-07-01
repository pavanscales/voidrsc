import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'stream';
import { router } from './router';
import { renderRSC } from './render';
import { preloadAll } from './preload';
import { logMetrics } from './metrics';
import { profiler } from './profiler';
import { env } from './env';

// Import routes so they're registered before server starts
import './routes';

const bootStart = Date.now();
const { start: profilerStart, stop: profilerStop, trackColdStart } = profiler;

async function main() {
  await preloadAll();
  trackColdStart(bootStart);

  const port = env.PORT ?? 3000;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
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

      // Convert Node.js request to Fetch API Request
      // @ts-expect-error 'duplex' is supported in Node.js but not in TS typings yet
      const fetchRequest = new Request(url.toString(), {
        method,
        headers: req.headers as HeadersInit,
        duplex: 'half',
        body:
          method === 'GET' || method === 'HEAD'
            ? null
            : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>),
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
          if (done) break;
          if (value) res.write(decoder.decode(value));
        }
      }

      res.end();
    } catch (err) {
      console.error('❌ Server error:', err);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    } finally {
      const duration = Date.now() - reqStart;
      console.log(`📡 [${req.method}] ${req.url} - ${duration}ms`);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Server started on http://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('❌ Server failed to start:', err);
    process.exit(1);
  });

  logMetrics(bootStart);
}

main().catch((err) => {
  console.error('❌ Fatal error during server startup:', err);
  process.exit(1);
});
