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

  const server = http2.createServer();

  server.on('stream', async (stream, headers) => {
    const reqStart = Date.now();

    try {
      const method = headers[':method'];
      const path = headers[':path'];
      const authority = headers[':authority'];

      if (!method || !path) {
        stream.respond({ ':status': 400 });
        return stream.end('Bad Request');
      }

      const url = new URL(path, `https://${authority}`);
      const fetchRequest = new Request(url.toString(), {
        method,
        headers: headers as HeadersInit,
        body:
          method === 'GET' || method === 'HEAD'
            ? null
            : (Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>),
      });

      // Try static
      const staticResponse = await serveStatic(fetchRequest);
      if (staticResponse) {
        const { status, headers: resHeaders, body } = staticResponse;
        stream.respond(
          Object.fromEntries(resHeaders.entries()) as http2.OutgoingHttpHeaders
        );
        if (body) {
          const readable = Readable.fromWeb(body);
          readable.pipe(stream);
        } else {
          stream.end();
        }
        return;
      }

      const routeMatch = await router.match(url.pathname);
      if (!routeMatch) {
        stream.respond({ ':status': 404, 'content-type': 'text/plain' });
        return stream.end('Not Found');
      }

      profilerStart();

      const response = await router.render(fetchRequest, url.pathname);

      profilerStop();

      const resHeaders: http2.OutgoingHttpHeaders = {};
      response.headers.forEach((v, k) => (resHeaders[k] = v));
      stream.respond({ ':status': response.status, ...resHeaders });

      if (response.body) {
        const readable = Readable.fromWeb(response.body);
        readable.pipe(stream);
      } else {
        stream.end();
      }
    } catch (err) {
      console.error('❌ Handler error:', err);
      stream.respond({ ':status': 500, 'content-type': 'text/plain' });
      stream.end('Internal Server Error');
    } finally {
      const duration = Date.now() - reqStart;
      console.log(`📡 [${headers[':method']}] ${headers[':path']} - ${duration}ms`);
    }
  });

  server.listen(port, () => {
    console.log(`🚀 Worker ${process.pid} started on https://localhost:${port}`);
  });

  server.on('error', (err) => {
    if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`❌ Port ${port} already in use`);
    } else {
      console.error('❌ Server error:', err);
    }
    process.exit(1);
  });

  logMetrics(bootStart);
}

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  console.log(`🧠 Master ${process.pid} running with ${numCPUs} workers`);
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  cluster.on('exit', (worker) => {
    console.warn(`⚠️ Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  runServer().catch((err) => {
    console.error('❌ Fatal startup error:', err);
    process.exit(1);
  });
}
