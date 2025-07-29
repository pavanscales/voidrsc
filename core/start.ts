import fs from "fs";
import path from "path";
import http from "http";
import http2 from "http2";
import cluster from "cluster";
import os from "os";
import zlib from "zlib";
import { Readable } from "stream";

import { router } from "./router";
import { preloadAll } from "./preload";
import { logMetrics } from "./metrics";
import { env } from "./env";
import { serveStatic } from "./serveStatic";

import "./routes";

if (!globalThis.__VOIDRSC__) globalThis.__VOIDRSC__ = {};
globalThis.__VOIDRSC__.env = env;

const bootStart = Date.now();
const port = Number(env.PORT ?? 3000);
const isDev = process.env.NODE_ENV !== "production";

if (isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT in env: "${env.PORT}". Must be between 1-65535.`);
}

function logRequest(method: string, url: string, duration: number) {
  const mem = process.memoryUsage();
  console.log(
    `${method} ${url} - ${duration}ms | Heap: ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB | RSS: ${(mem.rss / 1024 / 1024).toFixed(2)} MB`
  );
}

async function handler(
  req: http.IncomingMessage | http2.Http2ServerRequest,
  res: http.ServerResponse | http2.Http2ServerResponse
) {
  const start = Date.now();

  try {
    const method = "method" in req ? req.method : req.headers[":method"];
    const rawPath = "url" in req ? req.url : req.headers[":path"];
    const host = req.headers[":authority"] || req.headers["host"];

    if (!method || !rawPath || !host) {
      res.writeHead(400, { "Content-Type": "text/plain" }).end("Bad Request");
      return;
    }

    const url = new URL(rawPath as string, `http://${host}`);
    const fetchRequest = new Request(url.toString(), {
      method,
      headers: req.headers as HeadersInit,
      body: ["GET", "HEAD"].includes(method.toUpperCase())
        ? null
        : (Readable.toWeb?.(req as any) ?? req) as any,
    });

    const staticRes = await serveStatic(fetchRequest).catch(console.error);
    if (staticRes) {
      res.writeHead(staticRes.status, Object.fromEntries(staticRes.headers.entries()));
      if (staticRes.body) {
        Readable.fromWeb(staticRes.body).pipe(res as any);
      } else {
        res.end();
      }
      return;
    }

    const dynRes = await router.render(fetchRequest, url.pathname);
    if (!dynRes) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not Found");
      return;
    }

    const headers: Record<string, string> = Object.fromEntries(dynRes.headers.entries());
    headers["Cache-Control"] ??= "public, max-age=3600, stale-while-revalidate=60";
    headers["X-Content-Type-Options"] = "nosniff";
    headers["X-Frame-Options"] = "DENY";
    headers["X-XSS-Protection"] = "1; mode=block";

    const acceptsGzip = req.headers["accept-encoding"]?.includes("gzip");
    let body = dynRes.body ? Readable.fromWeb(dynRes.body) : null;

    if (body && headers["Content-Type"]?.includes("text") && acceptsGzip) {
      headers["Content-Encoding"] = "gzip";
      body = body.pipe(zlib.createGzip());
    }

    res.writeHead(dynRes.status ?? 200, headers);
    body ? body.pipe(res as any) : res.end();
  } catch (err) {
    console.error("Server Error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" }).end("Internal Server Error");
  } finally {
    const duration = Date.now() - start;
    const method = "method" in req ? req.method : req.headers[":method"];
    const path = "url" in req ? req.url : req.headers[":path"];
    logRequest(method ?? "UNKNOWN", path ?? "UNKNOWN", duration);
  }
}

async function runServer() {
  await preloadAll();

  const server = isDev
    ? http.createServer(handler)
    : http2.createSecureServer(
        {
          key: fs.readFileSync(path.join(process.cwd(), "certs/key.pem")),
          cert: fs.readFileSync(path.join(process.cwd(), "certs/cert.pem")),
        },
        handler
      );

  server.listen(port, "0.0.0.0", () => {
    console.log(`🧵 Worker ${process.pid} ready at ${isDev ? "http" : "https"}://localhost:${port}`);
    console.log(`${isDev ? "⏱️ Cold start" : "📊 Metrics"}: ${Date.now() - bootStart}ms`);
    if (!isDev) logMetrics(bootStart);
  });

  server.on("error", (err) => {
    console.error("Server error:", err);
    process.exit(1);
  });
}

if (cluster.isPrimary) {
  const cpus = os.cpus().length;
  const workers = isDev ? Math.min(4, cpus) : cpus;

  console.log(`👑 Master ${process.pid} starting ${workers} workers`);
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on("exit", (worker) => {
    console.log(`💀 Worker ${worker.process.pid} exited. Restarting...`);
    cluster.fork();
  });
} else {
  runServer().catch((err) => {
    console.error("Fatal server boot failure:", err);
    process.exit(1);
  });
}
