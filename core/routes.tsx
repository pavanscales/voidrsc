import { readdirSync, statSync } from "fs";
import path, { sep } from "path";
import { pathToFileURL } from "url";
import { router } from "./router";
import { renderRSC } from "./renderRSC";
import React from "react";

const appDir = path.join(process.cwd(), "app");

/**
 * Recursively walk the directory and collect all .tsx files
 */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((file) => {
    const fullPath = path.join(dir, file);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return walk(fullPath);
    return file.endsWith(".tsx") ? [fullPath] : [];
  });
}

/**
 * Convert file path to clean route path
 * e.g. /app/blog/[slug]/page.tsx → /blog/[slug]
 */
function toRoutePath(filePath: string): string {
  const relPath = path.relative(appDir, filePath).replace(/\/?page\.tsx$/, "");
  const segments = relPath.split(sep).filter(Boolean);
  return "/" + segments.join("/");
}

/**
 * Load component module dynamically from file path
 */
async function loadModule(filePath: string) {
  const mod = await import(pathToFileURL(filePath).href);
  return mod;
}

/**
 * Compose nested layouts around the page component
 */
async function composeLayouts(routePath: string, pageElement: React.ReactElement, req: Request, params: any) {
  const match = router.match(routePath);
  if (!match) return pageElement;

  let composed = pageElement;
  for (const layoutNode of match.layouts.reverse()) {
    if (!layoutNode.layoutHandler) continue;
    const LayoutComponent = await layoutNode.layoutHandler(req, params);
    composed = React.createElement(LayoutComponent as any, {
      children: composed,
      params,
    });
  }

  return composed;
}

/**
 * Discover all valid app routes and register them
 */
for (const filePath of walk(appDir)) {
  const fileName = path.basename(filePath);
  const isLayout = fileName === "layout.tsx";
  const isPage = fileName === "page.tsx";
  if (!isLayout && !isPage) continue;

  const routePath = toRoutePath(filePath);
  const isGroup = filePath.includes(`${sep}(`);

  console.log(`✅ Registered route: ${routePath} → ${filePath}`);

  router.addRoute(
    routePath,
    {
      handler: async (req, params) => {
        try {
          console.log(`⏳ Rendering: ${routePath}`);
          const mod = await loadModule(filePath);
          const Component = mod.default;
          if (!Component) throw new Error(`No default export in ${filePath}`);

          const pageElement = React.createElement(Component, { params });
          const composed = await composeLayouts(routePath, pageElement, req, params);

          return renderRSC({
            route: { handler: () => composed },
            req,
          });
        } catch (err) {
          console.error(`❌ Failed to render ${routePath}:`, err);
          return new Response("Internal Server Error", { status: 500 });
        }
      },

      getServerData: async (req, params) => {
        const mod = await loadModule(filePath);
        return typeof mod.getServerData === "function"
          ? mod.getServerData(req, params)
          : undefined;
      },
    },
    { isLayout, isGroup }
  );
}
