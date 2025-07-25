import React from 'react'
import { renderToReadableStream } from './rsc'
import { cache } from './cache'
import { profiler } from './profiler'
import { getPublicEnv } from './env'

const encoder = new TextEncoder()
const publicEnvString = JSON.stringify(getPublicEnv()).replace(/</g, '\\u003c')

const earlyHead = encoder.encode(
  `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VoidEngine</title><script>window.__VOID_ENV__=${publicEnvString}</script><link rel="stylesheet" href="/main.css" media="print" onload="this.media='all'"><noscript><link rel="stylesheet" href="/main.css"></noscript><style>body{margin:0;font-family:system-ui,sans-serif}</style></head><body><div id="root">`
)
const shellEnd = encoder.encode(`</div></body></html>`)

const responseHeaders = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
}

const layoutPromise = loadLayouts()

export async function renderRSC({ route, req }) {
  profiler.start()
  performance.mark('rsc-start')

  const url = new URL(req.url)
  const key = `RSC:${req.method}:${url.pathname}:${hashSearchParams(url.searchParams)}`
  const clientETag = req.headers.get('if-none-match')

  try {
    const cached = await cache.get(key)
    if (cached?.etag === clientETag) {
      return new Response(null, { status: 304, headers: { ETag: clientETag } })
    }

    if (cached?.buffer) {
      profiler.mark('rsc-cache-hit')
      logPerf('CACHE_HIT', 'rsc-start')
      return streamBuffer(cached.buffer, cached.etag, req)
    }

    const encoding = getBestCompression(req.headers)
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()

    writer.write(earlyHead)

    const [serverData, layouts] = await Promise.all([
      route.getServerData?.(req).catch(() => undefined),
      layoutPromise,
    ])

    let jsx = await route.handler(req, serverData)
    for (let i = layouts.length - 1; i >= 0; i--) jsx = layouts[i](jsx)

    const rscStream = await renderToReadableStream(jsx)
    const [clientStream, serverStream] = rscStream.tee()

    // Background cache without blocking stream
    cacheStream(key, serverStream).catch(console.warn)

    const reader = clientStream.getReader()
    const writerLoop = async () => {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        await writer.write(value)
      }
      await writer.write(shellEnd)
      await writer.close()
    }

    writerLoop()

    profiler.mark('rsc-render-done')
    logPerf('CACHE_MISS', 'rsc-start')

    return new Response(readable.pipeThrough(createCompressionStream(encoding)), {
      headers: {
        ...responseHeaders,
        ...(encoding !== 'none' && { 'Content-Encoding': encoding }),
      },
    })
  } catch (err) {
    console.error('RSC render error:', err)
    return renderError500(err.message || 'Internal Server Error')
  } finally {
    profiler.stop()
  }
}

function streamBuffer(buffer, etag, req) {
  const encoding = getBestCompression(req.headers)
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()

  writer.write(earlyHead)
  writer.write(buffer)
  writer.write(shellEnd)
  writer.close()

  return new Response(readable.pipeThrough(createCompressionStream(encoding)), {
    headers: {
      ...responseHeaders,
      ...(etag && { ETag: etag }),
      ...(encoding !== 'none' && { 'Content-Encoding': encoding }),
    },
  })
}

async function cacheStream(key, stream) {
  const reader = stream.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done || !value) break
      total += value.length
      if (total > 512 * 1024) break // Max 512KB
      chunks.push(value)
    }
    const buffer = mergeChunks(chunks)
    const etag = `"v1-${total}-${Date.now()}"`
    await cache.set(key, { buffer, etag })
  } catch (err) {
    console.warn('[Cache Fail]', err)
  } finally {
    reader.releaseLock()
  }
}

function mergeChunks(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function getBestCompression(headers) {
  const ae = headers?.get('accept-encoding') || ''
  if (/\bbr\b/.test(ae)) return 'br'     // Prefer Brotli first
  if (/\bgzip\b/.test(ae)) return 'gzip'
  return 'none'
}

function createCompressionStream(encoding) {
  try {
    if (encoding === 'br') return new CompressionStream('br')
    if (encoding === 'gzip') return new CompressionStream('gzip')
  } catch {}
  return new TransformStream()
}

async function loadLayouts() {
  return Object.freeze(
    ((globalThis._layouts || []) as ((n: React.ReactNode) => React.ReactNode)[]).reverse()
  )
}

function renderError500(message) {
  return new Response(
    `<!DOCTYPE html><html><body><h1>500</h1><pre>${escapeHtml(message)}</pre></body></html>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

function escapeHtml(str: string) {
  return str.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  )
}

function logPerf(stage: string, startMark: string) {
  performance.mark('rsc-end')
  performance.measure(stage, startMark, 'rsc-end')
  const entries = performance.getEntriesByName(stage)
  const duration = entries.length ? entries[entries.length - 1].duration : 0
  console.log(`[PERF][${stage}] ${duration.toFixed(1)}ms`)
}

function hashSearchParams(params: URLSearchParams) {
  return [...params.entries()].sort().map(([k, v]) => `${k}=${v}`).join('&')
}
