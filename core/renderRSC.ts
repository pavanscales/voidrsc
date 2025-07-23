// ░█░█░█▀▄░█▀▀░█▀▀░█▀█░█▀█░█░█░▀█▀░█▀█░█▀▀
// ░█░█░█▀▄░█▀▀░█░░░█░█░█▀█░░█░░░█░░█░█░▀▀█
// ░▀▀▀░▀░▀░▀▀▀░▀▀▀░▀▀▀░▀░▀░░▀░░▀▀▀░▀░▀░▀▀▀
//
// 🧠 VoidEngine: Server-Streaming React Core (RSC)
// ⚡ Built for latency critical paths. Streams fast. Caches smarter. Reacts instantly.

import React from 'react';
import { renderToReadableStream } from './rsc';
import { cache } from './cache';
import { profiler } from './profiler';
import { getPublicEnv } from './env';
import { mutateData } from './handleAction';

const encoder = new TextEncoder();
const publicEnvString = JSON.stringify(getPublicEnv()).replace(/</g, '\\u003c');

const earlyHead = encoder.encode(
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VoidEngine</title><script>window.__VOID_ENV__=${publicEnvString}</script><link rel="stylesheet" href="/main.css" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="/main.css"></noscript><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body><div id="root">`
);

const shellEnd = encoder.encode(`</div></body></html>`);

const responseHeaders: HeadersInit = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
};

let cachedLayouts: ((children: React.ReactNode) => React.ReactNode)[] | null = null;

// ─────────────────────────────────────────────────────────────
// 🚀 RSC Streaming Renderer
// ─────────────────────────────────────────────────────────────

export async function renderRSC({ route, req }: {
  route: {
    handler: (req: Request, data?: any) => Promise<React.ReactNode>;
    getServerData?: (req: Request) => Promise<any>;
  };
  req: Request;
}): Promise<Response> {
  profiler.start();
  performance.mark('rsc-start');

  try {
    const url = new URL(req.url);
    const cacheKey = `RSC:${req.method}:${url.pathname}?${url.searchParams}`;

    // ETag support
    const clientETag = req.headers.get('if-none-match');
    const cachedETag = await cache.get(`${cacheKey}:etag`);
    if (clientETag && cachedETag === clientETag) {
      return new Response(null, { status: 304, headers: { ETag: clientETag } });
    }

    const cached = cache.get(cacheKey);
    if (cached instanceof Uint8Array) {
      profiler.mark('rsc-cache-hit');
      logPerf('CACHE_HIT', 'rsc-start');
      return renderShellFromBuffer(cached, cachedETag);
    }

    const [serverData, layouts] = await Promise.all([
      route.getServerData?.(req).catch(() => undefined),
      loadLayouts(),
    ]);

    let jsx = await route.handler(req, serverData);
    for (const wrap of layouts) jsx = wrap(jsx);

    const stream = await renderToReadableStream(jsx);
    const [clientStream, serverStream] = stream.tee();

    const etag = await cacheStream(cacheKey, serverStream);

    profiler.mark('rsc-render-done');
    logPerf('CACHE_MISS', 'rsc-start');
    return renderShell(clientStream, etag);

  } catch (err: any) {
    console.error('❌ RSC render error:', err);
    return renderError500(err.message || 'Internal Server Error');
  } finally {
    profiler.stop();
  }
}

// ─────────────────────────────────────────────────────────────
// 🔧 Mutation Handler (Invalidates Cache + Updates State)
// ─────────────────────────────────────────────────────────────

export async function handleMutation(req: Request): Promise<Response> {
  try {
    const input = await req.json();
    const ctx = { headers: req.headers, cookies: {} };

    const result = await mutateData(input, ctx);

    if (result.status === 'error') {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (result.route) {
      cache.delete(`RSC:GET:${result.route}`);
      cache.delete(`RSC:GET:${result.route}:etag`);
      console.log(`[CACHE] Invalidated route: ${result.route}`);
    }

    return new Response(JSON.stringify({ status: 'success', result: result.result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Mutation error:', err);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ─────────────────────────────────────────────────────────────
// 🧩 Router Entry Point
// ─────────────────────────────────────────────────────────────

export async function handler(req: Request, route: any): Promise<Response> {
  switch (req.method) {
    case 'GET': return renderRSC({ route, req });
    case 'POST':
    case 'PATCH': return handleMutation(req);
    default: return new Response('Method Not Allowed', { status: 405 });
  }
}

// ─────────────────────────────────────────────────────────────
// 💨 Shell Streaming Helpers
// ─────────────────────────────────────────────────────────────

function renderShell(stream: ReadableStream<Uint8Array>, etag?: string): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = stream.getReader();

  (async () => {
    try {
      await writer.ready;
      writer.write(earlyHead);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        writer.write(value!);
      }
      writer.write(shellEnd);
    } catch (err) {
      console.error('❌ Stream error:', err);
    } finally {
      writer.close();
      reader.releaseLock();
    }
  })();

  return new Response(readable.pipeThrough(createCompressionStream()), {
    headers: {
      ...responseHeaders,
      ...(etag && { ETag: etag }),
    },
  });
}

function renderShellFromBuffer(buffer: Uint8Array, etag?: string): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  writer.write(earlyHead);
  writer.write(buffer);
  writer.write(shellEnd);
  writer.close();

  return new Response(readable.pipeThrough(createCompressionStream()), {
    headers: {
      ...responseHeaders,
      ...(etag && { ETag: etag }),
    },
  });
}

function createCompressionStream(): TransformStream<Uint8Array, Uint8Array> {
  try {
    return typeof CompressionStream !== 'undefined'
      ? new CompressionStream('br')
      : new TransformStream();
  } catch {
    return new TransformStream();
  }
}

// ─────────────────────────────────────────────────────────────
// 🧠 Stream Cache Writer
// ─────────────────────────────────────────────────────────────

async function cacheStream(key: string, stream: ReadableStream<Uint8Array>): Promise<string | undefined> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      total += value.length;
      if (total > 128 * 1024) break;
      chunks.push(value);
    }

    if (total < 1024) return; // Ignore micro payloads

    const buffer = mergeChunks(chunks);
    const etag = `"v1-${total}-${Date.now()}"`;
    cache.set(key, buffer);
    cache.set(`${key}:etag`, etag);
    console.log(`[CACHE] Stored ${total} bytes under key ${key}`);
    return etag;
  } catch (err) {
    console.warn('⚠️ Cache stream failed:', err);
  } finally {
    reader.releaseLock();
  }
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

// ─────────────────────────────────────────────────────────────
// 📦 Layout Injection
// ─────────────────────────────────────────────────────────────

async function loadLayouts() {
  if (!cachedLayouts) {
    const layouts = (globalThis as any)._layouts as ((n: React.ReactNode) => React.ReactNode)[] | undefined;
    cachedLayouts = layouts ? [...layouts].reverse() : [];
    Object.freeze(cachedLayouts);
  }
  return cachedLayouts!;
}

// ─────────────────────────────────────────────────────────────
// ❌ Error Renderer
// ─────────────────────────────────────────────────────────────

function renderError500(message: string): Response {
  const html = `<!DOCTYPE html><html><body><h1>500 - Server Error</h1><pre>${escapeHtml(message)}</pre></body></html>`;
  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c)
  );
}

// ─────────────────────────────────────────────────────────────
// ⏱️ Perf Logger
// ─────────────────────────────────────────────────────────────

function logPerf(stage: string, startMark: string) {
  performance.mark('rsc-end');
  performance.measure(stage, startMark, 'rsc-end');
  const entries = performance.getEntriesByName(stage);
  const duration = entries.length ? entries[entries.length - 1].duration : 0;
  console.log(`[PERF][${stage}] ${duration.toFixed(1)}ms`);
}
