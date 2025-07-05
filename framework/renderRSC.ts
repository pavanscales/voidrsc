// renderRSC-dominator.ts
import React from 'react';
import { renderToReadableStream } from './rsc';
import { cache } from './cache';
import { profiler } from './profiler';
import { getPublicEnv } from './env';
import { createBrotliCompress } from 'zlib';
import { Writable } from 'stream/web';

const encoder = new TextEncoder();
const publicEnvString = JSON.stringify(getPublicEnv()).replace(/</g, '\u003c');

const earlyHead = encoder.encode(
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VoidEngine</title><script>window.__VOID_ENV__=${publicEnvString}</script>
<link rel="preload" href="/main.css" as="style" />
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body><div id="root">`
);
const shellEnd = encoder.encode(`</div></body></html>`);

const responseHeaders: HeadersInit = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
};

let cachedLayouts: ((children: React.ReactNode) => React.ReactNode)[] | null = null;
const layoutMemo = new Map<symbol, React.ReactNode>();

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms)),
  ]);
}

export async function renderRSC({
  route,
  req,
}: {
  route: {
    handler: (req: Request, data?: any) => Promise<React.ReactNode>;
    getServerData?: (req: Request) => Promise<any>;
  };
  req: Request;
}): Promise<Response> {
  const startTime = performance.now();
  profiler.start();

  try {
    const url = new URL(req.url);
    const cacheKey = `RSC:${req.method}:${url.pathname}?${url.searchParams.toString()}`;

    const cached = cache.get(cacheKey);
    if (cached instanceof Uint8Array) {
      logPerf('CACHE_HIT', startTime);
      return htmlShellBuffer(cached);
    }

    const [serverData, layouts] = await Promise.all([
      route.getServerData ? timeout(route.getServerData(req), 1000).catch(() => undefined) : undefined,
      loadLayouts(),
    ]);

    let jsx = await timeout(route.handler(req, serverData), 1200);
    const routeId = Symbol.for(url.pathname);
    if (layoutMemo.has(routeId)) {
      jsx = layoutMemo.get(routeId)!;
    } else {
      for (const wrap of layouts) jsx = wrap(jsx);
      layoutMemo.set(routeId, jsx);
    }

    const streamPromise = renderToReadableStream(Promise.resolve().then(() => jsx));
    const [client, server] = (await streamPromise).tee();
    cacheStream(cacheKey, server);
    logPerf('CACHE_MISS', startTime);
    return htmlShell(client);
  } catch (err: any) {
    return error500(err.message || 'Internal Server Error');
  } finally {
    profiler.stop();
  }
}

function htmlShellBuffer(buffer: Uint8Array): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  writer.write(earlyHead);
  writer.write(buffer);
  writer.write(shellEnd);
  writer.close();
  return new Response(readable.pipeThrough(createCompressionStream()), {
    headers: responseHeaders,
  });
}

function htmlShell(stream: ReadableStream<Uint8Array>): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = stream.getReader();

  (async () => {
    writer.write(earlyHead);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      writer.write(value);
    }
    writer.write(shellEnd);
    writer.close();
    reader.releaseLock();
  })();

  return new Response(readable.pipeThrough(createCompressionStream()), {
    headers: responseHeaders,
  });
}

function createCompressionStream(): TransformStream<Uint8Array, Uint8Array> {
  try {
    return new CompressionStream('br');
  } catch {
    const { readable, writable } = new TransformStream();
    const compress = createBrotliCompress();
    const writer = writable.getWriter();
    const reader = readable.getReader();

    (async () => {
      const nodeStream = new Writable({
        write(chunk) {
          writer.write(chunk);
        },
        close() {
          writer.close();
        },
      });
      reader.pipeTo(nodeStream);
    })();

    return { readable, writable };
  }
}

async function cacheStream(cacheKey: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks = new Array<Uint8Array>(128);
  let total = 0;
  let index = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks[index++] = value;
      total += value.length;
      if (total > 128 * 1024 || index >= 128) {
        await persist(cacheKey, chunks.slice(0, index));
        index = 0;
        total = 0;
      }
    }
  }

  if (index) await persist(cacheKey, chunks.slice(0, index));
  reader.releaseLock();
}

async function persist(cacheKey: string, chunks: Uint8Array[]) {
  const size = chunks.reduce((sum, c) => sum + c.length, 0);
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  cache.set(cacheKey, buffer);
}

async function loadLayouts() {
  if (!cachedLayouts) {
    const layouts = (globalThis as any)._layouts as ((node: React.ReactNode) => React.ReactNode)[];
    cachedLayouts = layouts ? [...layouts].reverse() : [];
  }
  return cachedLayouts!;
}

function error500(msg: string): Response {
  const html = `<!DOCTYPE html><html><body><h1>500 Error</h1><pre>${escapeHtml(msg)}</pre></body></html>`;
  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c
  ));
}

function logPerf(stage: string, start: number) {
  const duration = performance.now() - start;
  console.log(`[PERF][${stage}] took ${duration.toFixed(1)}ms`);
}