import { readdirSync, statSync } from "fs";
import path from "path";
import { router } from "./router";

// Recursively get all .tsx files from /pages
const pagesDir = path.join(process.cwd(), "pages");

function walk(dir: string): string[] {
  const files = readdirSync(dir);
  return files.flatMap((file) => {
    const fullPath = path.join(dir, file);
    if (statSync(fullPath).isDirectory()) return walk(fullPath);
    if (!file.endsWith(".tsx")) return [];
    return [fullPath];
  });
}

function toRoutePath(filePath: string): string {
  const relPath = filePath.replace(pagesDir, "").replace(/\.tsx$/, "");
  const segments = relPath.split(path.sep).filter(Boolean);

  return (
    "/" +
    segments
      .map((seg) =>
        seg.startsWith("[") && seg.endsWith("]")
          ? `:${seg.slice(1, -1)}`
          : seg
      )
      .join("/")
  );
}

for (const filePath of walk(pagesDir)) {
  const routePath = toRoutePath(filePath);
  const fileName = path.basename(filePath);
  const isLayout = fileName === "_layout.tsx";
  const isGroup = filePath.includes(`${path.sep}(`); // folders like /(auth)

  router.addRoute(
    routePath,
    async () => {
      const { default: Component } = await import(filePath);
      return <Component />;
    },
    { isLayout, isGroup }
  );
}
