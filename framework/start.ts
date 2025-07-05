// optimized-start.ts
import fs from 'fs';
import path from 'path';
import http from 'http';
import http2 from 'http2';
import cluster from 'cluster';
import os from 'os';
import { Readable } from 'stream';
import { router } from './router';
import { preloadAll } from './preload';
import { logMetrics } from './metrics';
import { env } from './env'; // ✅ import env system
import { serveStatic } from './serveStatic';
import zlib from 'zlib';

// ✅ Register env globally in the runtime
if (!globalThis.__VOIDRSC__) globalThis.__VOIDRSC__ = {};
globalThis.__VOIDRSC__.env = env;

import './routes';

const bootStart = Date.now();
const port = env.PORT ?? 3000;
const isDev = process.env.NODE_ENV !== 'production';

function logRequest(method: string, url: string, duration: number) {
  const mem = process.memoryUsage();
  console.log(
    `⏱️ ${method} ${url} - ${duration}ms | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`
  );
}

async function handler(
  req: http.IncomingMessage | http2.Http2ServerRequest,
  res: http.ServerResponse | http2.Http2ServerResponse
) {
  const reqStart = Date.now();

  try {
    const method = 'method' in req ? req.method : req.headers[':method'];
    const rawPath = 'url' in req ? req.url : req.headers[':path'];
    const host = 'headers' in req && 'host' in req.headers ? req.headers.host : req.headers[':authority'];

    console.log('📥 Incoming:', { method, rawPath, host });

    if (!method || !rawPath || !host) {
      res.statusCode = 400;
      return res.end('Bad Request');
    }

    const url = new URL(rawPath!, `http://${host}`);
    const fetchRequest = new Request(url.toString(), {
      method,
      headers: req.headers as HeadersInit,
      body:
        method === 'GET' || method === 'HEAD'
          ? null
          : (Readable.toWeb(req as any) as unknown as ReadableStream<Uint8Array>),
    });

    // 📦 Static file check
    const staticResponse = await serveStatic(fetchRequest).catch((err) => {
      console.error('❌ serveStatic failed:', err);
    });

    if (staticResponse) {
      res.statusCode = staticResponse.status;
      for (const [key, value] of staticResponse.headers.entries()) {
        res.setHeader(key, value);
      }
      if (staticResponse.body) {
        const stream = Readable.fromWeb(staticResponse.body);
        stream.pipe(res as any);
      } else {
        res.end();
      }
      return;
    }

    // 🔀 Route resolution
    const response = await router.render(fetchRequest, url.pathname);
    console.log('📡 Routed:', response?.status ?? '404');

    if (!response) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('Not Found');
    }

    res.statusCode = response.status ?? 200;

    // Headers
    for (const [key, value] of response.headers.entries()) {
      res.setHeader(key, value);
    }

    // Default headers
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=60');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    if (response.body) {
      let stream = Readable.fromWeb(response.body);
      const contentType = response.headers.get('Content-Type');
      if (contentType?.includes('text')) {
        res.setHeader('Content-Encoding', 'gzip');
        stream = stream.pipe(zlib.createGzip());
      }
      stream.pipe(res as any);
    } else {
      res.end();
    }
  } catch (err) {
    console.error('❌ Server Error:', err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Internal Server Error');
  } finally {
    const duration = Date.now() - reqStart;
    const method = 'method' in req ? req.method : req.headers[':method'];
    const path = 'url' in req ? req.url : req.headers[':path'];
    logRequest(method ?? 'UNKNOWN', path ?? 'UNKNOWN', duration);
  }
}

async function runServer() {
  await preloadAll();

  const server = isDev
    ? http.createServer(handler)
    : http2.createSecureServer(
        {
          key: fs.readFileSync(path.join(process.cwd(), 'certs/key.pem')),
          cert: fs.readFileSync(path.join(process.cwd(), 'certs/cert.pem')),
        },
        handler
      );

  server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Worker ${process.pid} running at ${isDev ? 'http' : 'https'}://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('❌ Server failed:', err);
    process.exit(1);
  });

  isDev
    ? console.log(`⚡ Cold start: ${Date.now() - bootStart}ms`)
    : logMetrics(bootStart);
}

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  const workerCount = isDev ? Math.min(4, numCPUs) : numCPUs;

  console.log(`🧠 Master ${process.pid} launching ${workerCount} workers`);
  for (let i = 0; i < workerCount; i++) cluster.fork();

  cluster.on('exit', (worker) => {
    console.log(`⚠️ Worker ${worker.process.pid} crashed. Restarting...`);
    cluster.fork();
  });
} else {
  runServer().catch((err) => {
    console.error('❌ Fatal error during boot:', err);
    process.exit(1);
  });
}
