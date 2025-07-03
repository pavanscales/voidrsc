import { readdirSync, statSync } from "fs";
import path, { sep } from "path";
import { pathToFileURL } from "url";
import { router } from "./router";
import { renderRSC } from "./render"; // ✅ RSC renderer
import React from "react";

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
  const segments = relPath.split(sep).filter(Boolean);

  if (segments.length === 1 && segments[0] === "index") {
    return "/";
  }

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
  const isGroup = filePath.includes(`${sep}(`);

  console.log(`✅ Registered route: ${routePath} → ${filePath}`);

  router.addRoute(
    routePath,
    async (req, params) => {
      try {
        console.log(`⏳ Loading component for route: ${routePath}`);
        const { default: Component } = await import(pathToFileURL(filePath).href);
        console.log(`✅ Loaded component for route: ${routePath}`);

        const element = React.createElement(Component, { params });

        // ⬇️ Inject layout wrappers
        const match = router.match(routePath);
        const layouts = [];

        if (match) {
          for (const layoutNode of match.layouts) {
            if (layoutNode.layoutHandler) {
              const layoutComponent = await layoutNode.layoutHandler(req, params);
              layouts.push((child: React.ReactNode) =>
                React.createElement(layoutComponent as any, { children: child, params })
              );
            }
          }
        }

        (globalThis as any)._layouts = layouts;

        return renderRSC({
          route: {
            handler: () => element,
          },
          req,
        });
      } catch (e) {
        console.error(`❌ Error loading component for ${routePath}:`, e);
        throw e;
      }
    },
    { isLayout, isGroup }
  );
}
