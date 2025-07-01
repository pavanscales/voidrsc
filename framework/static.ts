import path from "path";
import { statSync, existsSync } from "fs";

// Ultra fast extension-to-MIME using Map (branchless)
const mimeMap = new Map([
  [".js", "application/javascript"],
  [".css", "text/css"],
  [".html", "text/html"],
  [".json", "application/json"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".eot", "application/vnd.ms-fontobject"],
]);

function mime(filePath: string): string {
  const ext = path.extname(filePath);
  return mimeMap.get(ext) || Bun.mime.lookup(filePath) || "application/octet-stream";
}

// ETag: stable hash via size + mtime
function getETag(stats: BunFileStats) {
  return `W/"${stats.size}-${stats.mtimeMs}"`;
}

// Range parser
function parseRangeHeader(range: string | null, size: number) {
  if (!range || !range.startsWith("bytes=")) return null;
  const [startStr, endStr] = range.replace("bytes=", "").split("-");
  const start = startStr ? parseInt(startStr, 10) : 0;
  const end = endStr ? parseInt(endStr, 10) : size - 1;
  if (isNaN(start) || isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

const publicDir = path.join(process.cwd(), "public");

export async function serveStatic(req: Request): Promise<Response | null> {
  try {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);
    const filePath = path.join(publicDir, pathname);

    // Secure path check (no directory traversal)
    if (!filePath.startsWith(publicDir)) return null;
    if (!existsSync(filePath)) return null;

    const stat = statSync(filePath);
    if (!stat.isFile()) return null;

    const file = Bun.file(filePath);
    const etag = getETag(await file.stat());

    const headers = new Headers();
    headers.set("Content-Type", mime(filePath));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", etag);
    headers.set("Accept-Ranges", "bytes");

    // ETag cache check
    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    // Handle HEAD requests
    if (req.method === "HEAD") {
      headers.set("Content-Length", stat.size.toString());
      return new Response(null, { status: 200, headers });
    }

    // Range request support
    const range = parseRangeHeader(req.headers.get("range"), stat.size);
    if (range) {
      const { start, end } = range;
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      headers.set("Content-Length", `${end - start + 1}`);
      return new Response(file.slice(start, end + 1).stream(), {
        status: 206,
        headers,
      });
    }

    headers.set("Content-Length", stat.size.toString());
    return new Response(file.stream(), { status: 200, headers });
  } catch {
    return null;
  }
}
