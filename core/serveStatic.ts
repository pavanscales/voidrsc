import { statSync, existsSync, createReadStream } from "fs";
import path from "path";
import { promisify } from "util";

const statAsync = promisify(statSync);

const mimeTypes = new Map<string, string>([
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

const publicDir = path.resolve(process.cwd(), "public");

function getMime(filePath: string): string {
  return mimeTypes.get(path.extname(filePath)) || "application/octet-stream";
}

function getETag(stats: { size: number; mtimeMs: number }) {
  return `W/"${stats.size}-${stats.mtimeMs}"`;
}

function parseRange(range: string | null, size: number) {
  if (!range?.startsWith("bytes=")) return null;

  const [startStr, endStr] = range.replace("bytes=", "").split("-");
  const start = startStr ? parseInt(startStr, 10) : 0;
  const end = endStr ? parseInt(endStr, 10) : size - 1;

  if (isNaN(start) || isNaN(end) || start > end || end >= size) return null;
  return { start, end };
}

export async function serveStatic(req: Request): Promise<Response | null> {
  try {
    const url = new URL(req.url);
    const decodedPath = decodeURIComponent(url.pathname);

    // Sanitize + resolve
    const filePath = path.resolve(publicDir, "." + decodedPath);
    if (!filePath.startsWith(publicDir) || !existsSync(filePath)) return null;

    const stat = statSync(filePath);
    if (!stat.isFile()) return null;

    const etag = getETag(stat);
    const headers = new Headers({
      "Content-Type": getMime(filePath),
      "Cache-Control": "public, max-age=31536000, immutable",
      "ETag": etag,
      "Accept-Ranges": "bytes",
    });

    if (req.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers });
    }

    const range = parseRange(req.headers.get("range"), stat.size);
    if (range) {
      const { start, end } = range;
      headers.set("Content-Range", `bytes ${start}-${end}/${stat.size}`);
      headers.set("Content-Length", `${end - start + 1}`);

      const stream = createReadStream(filePath, { start, end });
      return new Response(stream as any, { status: 206, headers });
    }

    if (req.method === "HEAD") {
      headers.set("Content-Length", stat.size.toString());
      return new Response(null, { status: 200, headers });
    }

    headers.set("Content-Length", stat.size.toString());
    const stream = createReadStream(filePath);
    return new Response(stream as any, { status: 200, headers });
  } catch {
    return null;
  }
}
