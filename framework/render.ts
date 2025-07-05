import React from 'react';
import { renderToReadableStream } from './rsc';
import { cache } from './cache';
import { profiler } from './profiler';
import { getPublicEnv } from './env';

const encoder = new TextEncoder();
const publicEnv = JSON.stringify(getPublicEnv()).replace(/</g, '\\u003c');

const shellStart = encoder.encode(
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fast RSC App</title><script>window.__VOID_ENV__=${publicEnv}</script><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body><div id="root">`
);
const shellEnd = encoder.encode(`</div></body></html>`);

const responseHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
};

let cachedLayouts: ((children: React.ReactNode) => React.ReactNode)[] | null = null;

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout exceeded')), ms)
    ),
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
  try {
    const url = new URL(req.url);
    const cacheKey = `${req.method}:${url.pathname}${url.search}`;

    const cachedBuffer = cache.get(cacheKey);
    if (cachedBuffer instanceof Uint8Array) {
      return htmlShellBuffer(cachedBuffer);
    }

    // Fetch server data (optional)
    let serverData: any = undefined;
    if (route.getServerData) {
      try {
        serverData = await withTimeout(route.getServerData(req), 1000);
      } catch (err) {
        console.warn('⚠️ getServerData failed:', err);
      }
    }

    // Render JSX with serverData
    let element = await withTimeout(route.handler(req, serverData), 2500);

    if (!cachedLayouts) {
      const layouts = (globalThis as any)._layouts as
        | ((children: React.ReactNode) => React.ReactNode)[]
        | undefined;
      cachedLayouts = layouts ? [...layouts].reverse() : [];
    }

    for (const wrap of cachedLayouts) {
      element = wrap(element);
    }

    if (!element || typeof element !== 'object') {
      throw new Error('Route handler returned invalid JSX');
    }

    const stream = await withTimeout(renderToReadableStream(element), 1500);
    return await streamWithCacheUsingTee(stream, cacheKey);
  } catch (error: any) {
    return error500(error.message);
  } finally {
    profiler.stop();
  }
}

function htmlShellBuffer(buffer: Uint8Array): Response {
  const fullStream = new ReadableStream({
    start(controller) {
      controller.enqueue(shellStart);
      controller.enqueue(buffer);
      controller.enqueue(shellEnd);
      controller.close();
    },
  });

  return new Response(fullStream, { headers: responseHeaders });
}

function htmlShell(stream: ReadableStream<Uint8Array>): Response {
  const fullStream = new ReadableStream({
    async start(controller) {
      controller.enqueue(shellStart);
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) controller.enqueue(value);
        }
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
        controller.enqueue(shellEnd);
        controller.close();
      }
    },
  });

  return new Response(fullStream, { headers: responseHeaders });
}

async function streamWithCacheUsingTee(
  stream: ReadableStream<Uint8Array>,
  cacheKey: string
): Promise<Response> {
  const [streamForClient, streamForCache] = stream.tee();

  cacheStreamChunks(cacheKey, streamForCache).catch((e) =>
    console.error('Cache write failed:', e)
  );

  return htmlShell(streamForClient);
}

async function cacheStreamChunks(
  cacheKey: string,
  stream: ReadableStream<Uint8Array>
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalSize += value.length;

        if (totalSize > 100 * 1024) {
          await saveChunksToCache(cacheKey, chunks);
          chunks.length = 0;
          totalSize = 0;
        }
      }
    }
    if (chunks.length > 0) {
      await saveChunksToCache(cacheKey, chunks);
    }
  } finally {
    reader.releaseLock();
  }
}

async function saveChunksToCache(cacheKey: string, chunks: Uint8Array[]) {
  try {
    const totalLength = chunks.reduce((a, c) => a + c.length, 0);
    const buffer = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.length;
    }
    cache.set(cacheKey, buffer);
  } catch (err) {
    console.error('Cache set failed:', err);
  }
}

function error500(msg: string): Response {
  const html = `<!DOCTYPE html><html><body><h1>500 Error</h1><pre>${escapeHtml(
    msg
  )}</pre></body></html>`;
  return new Response(html, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}
