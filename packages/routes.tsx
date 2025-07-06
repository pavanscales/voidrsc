import { readdirSync, statSync } from "fs";
import path, { sep } from "path";
import { pathToFileURL } from "url";
import { router } from "./router";
import { renderRSC } from "./renderRSC";
import React from "react";

const appDir = path.join(process.cwd(), "app");

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
  const relPath = filePath.replace(appDir, "").replace(/\/page\.tsx$/, "");
  const segments = relPath.split(sep).filter(Boolean);
  return "/" + segments.join("/");
}

for (const filePath of walk(appDir)) {
  const fileName = path.basename(filePath);
  const isLayout = fileName === "layout.tsx";
  const isPage = fileName === "page.tsx";
  const isGroup = filePath.includes(`${sep}(`);
  const routePath = toRoutePath(filePath);

  if (!isLayout && !isPage) continue;

  console.log(`✅ Registered route: ${routePath} → ${filePath}`);

  router.addRoute(
    routePath,
    {
      handler: async (req, params) => {
        try {
          console.log(`⏳ Loading component for route: ${routePath}`);
          const mod = await import(pathToFileURL(filePath).href);
          const Component = mod.default;

          const pageElement = React.createElement(Component, { params });

          // Compose layouts outer → inner
          const match = router.match(routePath);
          let composed = pageElement;

          if (match) {
            for (const layoutNode of match.layouts.reverse()) {
              if (layoutNode.layoutHandler) {
                const LayoutComponent = await layoutNode.layoutHandler(req, params);
                composed = React.createElement(LayoutComponent as any, {
                  children: composed,
                  params,
                });
              }
            }
          }

          return renderRSC({
            route: { handler: () => composed },
            req,
          });
        } catch (err) {
          console.error(`❌ Failed to load ${routePath}:`, err);
          return new Response("Internal Server Error", { status: 500 });
        }
      },

      getServerData: async (req, params) => {
        const mod = await import(pathToFileURL(filePath).href);
        return typeof mod.getServerData === "function"
          ? mod.getServerData(req, params)
          : undefined;
      },
    },
    { isLayout, isGroup }
  );
}
