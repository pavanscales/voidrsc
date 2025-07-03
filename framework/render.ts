import React from 'react'
import { renderToReadableStream } from './rsc'
import { cache } from './cache'
import { profiler } from './profiler'

const encoder = new TextEncoder()

const shellStart = encoder.encode(
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"/>' +
    '<title>Fast RSC App</title><style>body{margin:0;font-family:system-ui,sans-serif}</style>' +
    '</head><body><div id="root">'
)

const shellEnd = encoder.encode('</div></body></html>')

async function* combinedStreamGenerator(stream: ReadableStream<Uint8Array>) {
  yield shellStart
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      yield value
    }
  } finally {
    reader.releaseLock()
  }
  yield shellEnd
}

function htmlShell(stream: ReadableStream<Uint8Array>): Response {
  const combinedStream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of combinedStreamGenerator(stream)) {
          controller.enqueue(chunk)
        }
        controller.close()
      } catch (error) {
        controller.error(error)
      }
    },
  })

  return new Response(combinedStream, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=59',
    },
  })
}

// Optional timeout wrapper (prevent hangs)
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Timeout exceeded')), ms)
    ),
  ])
}

export async function renderRSC({
  route,
  req,
}: {
  route: { handler: (req: Request) => Promise<React.ReactNode> }
  req: Request
}): Promise<Response> {
  profiler.start()

  try {
    const url = new URL(req.url)
    const cacheKey = `${req.method}:${url.pathname}`

    const cached = cache.get(cacheKey)
    if (cached) return cached

    const element = await withTimeout(route.handler(req), 3000)

    if (!element || typeof element !== 'object') {
      throw new Error('Route handler returned invalid JSX element')
    }

    let rscStream: ReadableStream<Uint8Array>
    try {
      rscStream = await withTimeout(renderToReadableStream(element), 3000)
    } catch (err: any) {
      return error500(`Failed to render RSC: ${err.message}`)
    }

    // Tee safely or fallback to buffer on unsupported platforms
    if (typeof rscStream.tee !== 'function') {
      const buffered = await bufferStream(rscStream)
      const response = htmlShell(fromBuffer(buffered))
      cache.set(cacheKey, htmlShell(fromBuffer(buffered))) // clone-safe
      return response
    }

    const [body1, body2] = rscStream.tee()
    const response = htmlShell(body1)
    cache.set(cacheKey, htmlShell(body2))

    return response
  } catch (error: any) {
    return error500(error.message)
  } finally {
    profiler.stop()
  }
}

// If .tee() not supported, buffer the full stream
async function bufferStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  const length = chunks.reduce((sum, c) => sum + c.length, 0)
  const result = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

// Create ReadableStream from a single Uint8Array buffer
function fromBuffer(buffer: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(shellStart)
      controller.enqueue(buffer)
      controller.enqueue(shellEnd)
      controller.close()
    },
  })
}

function error500(msg: string): Response {
  const errorHTML = `<!DOCTYPE html><html><body><h1>Server Error</h1><pre>${escapeHtml(
    msg
  )}</pre></body></html>`
  return new Response(errorHTML, {
    status: 500,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}
