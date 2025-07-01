import http2 from 'http2';
import cluster from 'cluster';
import os from 'os';
import { Readable } from 'stream';
import { router } from './router';
import { renderRSC } from './render';
import { preloadAll } from './preload';
import { logMetrics } from './metrics';
import { profiler } from './profiler';
import { env } from './env';
import { serveStatic } from './serveStatic';

import './routes';

const bootStart = Date.now();
const { start: profilerStart, stop: profilerStop, trackColdStart } = profiler;
const port = env.PORT ?? 3000;

async function runServer() {
  await preloadAll();
  trackColdStart(bootStart);

  const server = http2.createServer(async (req, res) => {
    const reqStart = Date.now();
    try {
      if (!req.headers[':method'] || !req.headers[':path']) {
        res.statusCode = 400;
        return res.end('Bad Request');
      }

      const method = req.headers[':method'];
      const url = new URL(req.headers[':path'], `https://${req.headers[':authority']}`);

      // Convert to Fetch API Request
      const fetchRequest = new Request(url.toString(), {
        method,
        headers: req.headers as HeadersInit,
        body:
          method === 'GET' || method === 'HEAD'
            ? null
            : (Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>),
      });

      // Try static first
      const staticResponse = await serveStatic(fetchRequest);
      if (staticResponse) {
        res.statusCode = staticResponse.status;
        for (const [key, value] of staticResponse.headers) {
          res.setHeader(key, value);
        }
        if (staticResponse.body) {
          const nodeStream = Readable.fromWeb(staticResponse.body);
          nodeStream.pipe(res);
          nodeStream.once('end', () => res.end());
          return;
        }
        res.end();
        return;
      }

      // Dynamic routing
      const routeMatch = router.match(url.pathname, method);

      if (!routeMatch) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/plain');
        return res.end('Not Found');
      }

      profilerStart();

      const response = await renderRSC({ route: routeMatch, req: fetchRequest });

      profilerStop();

      if (!response.headers.has('Content-Type')) {
        response.headers.set('Content-Type', 'text/html');
      }

      res.statusCode = response.status;
      for (const [key, value] of response.headers) {
        res.setHeader(key, value);
      }

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body);
        nodeStream.pipe(res);
        nodeStream.once('end', () => res.end());
      } else {
        res.end();
      }
    } catch (err) {
      console.error('❌ Server error:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Internal Server Error');
    } finally {
      const duration = Date.now() - reqStart;
      console.log(`📡 [${req.headers[':method']}] ${req.headers[':path']} - ${duration}ms`);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Worker ${process.pid} started on https://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
  });

  logMetrics(bootStart);
}

if (cluster.isMaster) {
  const numCPUs = os.cpus().length;
  console.log(`🚀 Master ${process.pid} is running`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.log(`⚠️ Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  runServer().catch((err) => {
    console.error('❌ Fatal error during server startup:', err);
    process.exit(1);
  });
}
