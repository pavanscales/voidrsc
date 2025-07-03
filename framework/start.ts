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
import { env } from './env';
import { serveStatic } from './serveStatic';
import zlib from 'zlib';

import './routes';

const bootStart = Date.now();
const port = env.PORT ?? 3000;
const isDev = process.env.NODE_ENV !== 'production';

function logRequest(method: string, url: string, duration: number) {
  const mem = process.memoryUsage();
  console.log(
    `⏱️ ${method} ${url} - ${duration}ms | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(
      2
    )} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`
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

    console.log('📥 Request:', { method, rawPath, host });

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

    // Serve static assets
    try {
      const staticResponse = await serveStatic(fetchRequest);
      if (staticResponse) {
        res.statusCode = staticResponse.status;
        if (staticResponse.headers && typeof staticResponse.headers.entries === 'function') {
          for (const [key, value] of staticResponse.headers.entries()) {
            res.setHeader(key, value);
          }
        }
        if (staticResponse.body) {
          try {
            const stream = Readable.fromWeb(staticResponse.body);
            stream.pipe(res as any);
          } catch (err) {
            console.error('❌ Stream error (static):', err);
            res.end();
          }
        } else {
          res.end();
        }
        return;
      }
    } catch (err) {
      console.error('❌ serveStatic failed:', err);
    }

    // Route matching
    const response = await router.render(fetchRequest, url.pathname);
    console.log('📡 router.render returned:', response?.status ?? 'undefined');

    if (!response) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('Not Found');
    }

    res.statusCode = typeof response.status === 'number' ? response.status : 200;

    // ✅ Safe header handling
    if (response.headers && typeof response.headers.entries === 'function') {
      for (const [key, value] of response.headers.entries()) {
        res.setHeader(key, value);
      }
    }

    // Default headers
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=60');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');

    if (response.body) {
      try {
        let stream = Readable.fromWeb(response.body);
        if (response.headers?.get('Content-Type')?.includes('text')) {
          res.setHeader('Content-Encoding', 'gzip');
          stream = stream.pipe(zlib.createGzip());
        }
        stream.pipe(res as any);
      } catch (err) {
        console.error('❌ Failed to stream response:', err);
        res.statusCode = 500;
        return res.end('Stream error');
      }
    } else {
      res.end();
    }
  } catch (err) {
    console.error('❌ Top-level server error:', err);
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
    console.log(`🚀 Worker ${process.pid} started on ${isDev ? 'http' : 'https'}://localhost:${port}`);
  });

  server.on('error', (err) => {
    console.error('❌ Server error:', err);
    process.exit(1);
  });

  if (!isDev) {
    logMetrics(bootStart);
  } else {
    console.log(`🚀 Cold start took: ${Date.now() - bootStart}ms`);
  }
}

if (cluster.isPrimary) {
  const numCPUs = os.cpus().length;
  const workerCount = isDev ? Math.min(4, numCPUs) : numCPUs;

  console.log(`🧠 Master ${process.pid} running with ${workerCount} workers`);
  for (let i = 0; i < workerCount; i++) cluster.fork();

  cluster.on('exit', (worker) => {
    console.log(`⚠️ Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  runServer().catch((err) => {
    console.error('❌ Fatal startup error:', err);
    process.exit(1);
  });
}
