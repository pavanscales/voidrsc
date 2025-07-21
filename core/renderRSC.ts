import React from 'react';
import { renderToReadableStream } from './rsc';
import { cache } from './cache';
import { profiler } from './profiler';
import { getPublicEnv } from './env';
import { mutateData } from './handleAction';

const encoder = new TextEncoder();
const publicEnvString = JSON.stringify(getPublicEnv()).replace(/</g, '\\u003c');

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
  // Real HTTP/2 push depends on server support, keep but configure server
  'Link': '</main.css>; rel=preload; as=style',
};

let cachedLayouts: ((children: React.ReactNode) => React.ReactNode)[] | null = null;
// CHANGE: store only cached serialized buffers, not JSX trees
const layoutCache = new Map<string, Uint8Array>();

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
  profiler.start();
  performance.mark('rsc-start');

  try {
    const url = new URL(req.url);
    const cacheKey = `RSC:${req.method}:${url.pathname}?${url.searchParams}`;

    // Early hit: cached full HTML buffer (serialized)
    const cachedBuffer = cache.get(cacheKey);
    if (cachedBuffer instanceof Uint8Array) {
      profiler.mark('rsc-cache-hit');
      logPerf('CACHE_HIT', 'rsc-start');
      return renderShellFromBuffer(cachedBuffer);
    }

    // Parallel fetch server data + layouts
    const serverDataPromise = route.getServerData
      ? timeout(route.getServerData(req), 500).catch(() => undefined)
      : Promise.resolve(undefined);

    const layoutsPromise = loadLayouts();

    const [serverData, layouts] = await Promise.all([serverDataPromise, layoutsPromise]);

    // Compose React tree wrapped in layouts *without* caching JSX
    let jsx = await timeout(route.handler(req, serverData), 1000);
    for (const wrap of layouts) jsx = wrap(jsx);

    // Render stream ASAP (no Promise.resolve wrapper, just directly)
    const stream = await renderToReadableStream(jsx);
    const [clientStream, serverStream] = stream.tee();

    // Cache serialized chunks as buffer for fast reuse
    void cacheStream(cacheKey, serverStream);

    profiler.mark('rsc-render-done');
    logPerf('CACHE_MISS', 'rsc-start');

    return renderShell(clientStream);
  } catch (err: any) {
    console.error('❌ RSC render error:', err);
    return renderError500(err.message || 'Internal Server Error');
  } finally {
    profiler.stop();
  }
}

export async function handleMutation(req: Request): Promise<Response> {
  try {
    const input = await req.json();
    const ctx = {
      headers: req.headers,
      cookies: {}, // extract if available
    };

    const result = await mutateData(input, ctx);

    if (result.status === 'error') {
      return new Response(JSON.stringify({ error: result.error }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // FORCE: Invalidate cache for affected routes ASAP (important for freshness)
    // Assuming result.route is the pathname string, adjust as needed
    if (result.route) {
      cache.delete(`RSC:GET:${result.route}`);
      console.log(`[CACHE] Invalidated cache for route: ${result.route}`);
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

export async function handler(req: Request, route: any): Promise<Response> {
  if (req.method === 'GET') return renderRSC({ route, req });
  if (req.method === 'POST' || req.method === 'PATCH') return handleMutation(req);
  return new Response('Method Not Allowed', { status: 405 });
}

function renderShell(stream: ReadableStream<Uint8Array>): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const reader = stream.getReader();

  (async () => {
    try {
      writer.write(earlyHead);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) writer.write(value);
      }

      writer.write(shellEnd);
    } catch (err) {
      console.error('❌ Stream write error:', err);
    } finally {
      try { writer.close(); } catch {}
      try { reader.releaseLock(); } catch {}
    }
  })();

  return new Response(readable.pipeThrough(createCompressionStream()), {
    headers: responseHeaders,
  });
}

function renderShellFromBuffer(buffer: Uint8Array): Response {
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

function createCompressionStream(): TransformStream<Uint8Array, Uint8Array> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      return new CompressionStream('br');
    } catch {
      return new TransformStream();
    }
  }
  return new TransformStream();
}

async function cacheStream(cacheKey: string, stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.length;

      if (total > 128 * 1024) break;
    }
  }

  const buffer = mergeChunks(chunks);
  cache.set(cacheKey, buffer);

  try { reader.releaseLock(); } catch {}

  console.log(`[CACHE] Stored ${total} bytes for key ${cacheKey}`);
}

function mergeChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function loadLayouts() {
  if (!cachedLayouts) {
    const layouts = (globalThis as any)._layouts as ((n: React.ReactNode) => React.ReactNode)[] | undefined;
    cachedLayouts = layouts ? [...layouts].reverse() : [];
  }
  return cachedLayouts!;
}

function renderError500(message: string): Response {
  const html = `<!DOCTYPE html><html><body><h1>500 Error</h1><pre>${escapeHtml(message)}</pre></body></html>`;
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

function logPerf(stage: string, startMark: string) {
  performance.mark('rsc-end');
  performance.measure(stage, startMark, 'rsc-end');
  const entries = performance.getEntriesByName(stage);
  const duration = entries.length ? entries[entries.length - 1].duration : 0;
  console.log(`[PERF][${stage}] ${duration.toFixed(1)}ms`);
}
