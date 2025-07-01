import path from "path";
import fs from "fs";
import { promisify } from "util";

const statAsync = promisify(fs.stat);

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
  return mimeMap.get(ext) || "application/octet-stream";
}

// ETag: stable hash via size + mtime
function getETag(stats: fs.Stats) {
  return `W/"${stats.size}-${stats.mtimeMs}"`;
}

function parseRangeHeader(range: string | null, size: number) {
  if (!range || !range.startsWith("bytes=")) return null;
  const [startStr, endStr] = range.replace("bytes=", "").split("-");
  const start = startStr ? parseInt(startStr, 10) : 0;
  const end = endStr ? parseInt(endStr, 10) : size - 1;
  if (isNaN(start) || isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

const publicDir = path.resolve(process.cwd(), "public");

export async function serveStatic(req: Request): Promise<Response | null> {
  try {
    const url = new URL(req.url);
    const pathname = decodeURIComponent(url.pathname);
    const filePath = path.resolve(publicDir, `.${pathname}`);

    if (!filePath.startsWith(publicDir)) return null;
    if (!fs.existsSync(filePath)) return null;

    const stat = await statAsync(filePath);
    if (!stat.isFile()) return null;

    const etag = getETag(stat);

    const headers = new Headers();
    headers.set("Content-Type", mime(filePath));
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
    headers.set("ETag", etag);
    headers.set("Accept-Ranges", "bytes");

    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    if (req.method === "HEAD") {
      headers.set("Content-Length", stat.size.toString());
      return new Response(null, { status: 200, headers });
    }

    const range = parseRangeHeader(req.headers.get("range"), stat.size);
    if (range) {
      const { start, end } = range;
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      headers.set("Content-Length", `${end - start + 1}`);

      const fileStream = fs.createReadStream(filePath, { start, end });
      return new Response(fileStream as any, { // `as any` because Node.js streams aren't native fetch streams
        status: 206,
        headers,
      });
    }

    headers.set("Content-Length", stat.size.toString());
    const fullStream = fs.createReadStream(filePath);
    return new Response(fullStream as any, { status: 200, headers });
  } catch {
    return null;
  }
}
