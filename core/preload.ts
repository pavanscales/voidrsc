import { router } from './router';
import { renderRSC } from './renderRSC';
import { cache } from './cache';

const moduleCache = new Map<string, unknown>();

const sampleParams: Record<string, Record<string, string>> = {
  '/': {},
  '/user/:id': { id: '1' },
};

function resolveDynamicPath(path: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (acc, [key, val]) => acc.replace(`:${key}`, encodeURIComponent(val)),
    path
  );
}

async function preloadRoute(route: {
  path: string;
  isDynamic: boolean;
  paramNames?: string[];
  handler: unknown;
}) {
  let resolvedPath = route.path;

  // Replace dynamic parts using sampleParams
  if (route.isDynamic && route.paramNames) {
    const paramValues = sampleParams[route.path];
    if (!paramValues) return;

    resolvedPath = resolveDynamicPath(resolvedPath, paramValues);
  }

  // Avoid reloading if already cached
  if (cache.has(`GET:${resolvedPath}`)) return;

  // Lazy-load module once
  if (!moduleCache.has(resolvedPath)) {
    try {
      const module = await import(`../pages${resolvedPath}.tsx`).catch(() => null);
      moduleCache.set(resolvedPath, module);
    } catch {
      moduleCache.set(resolvedPath, null);
    }
  }

  try {
    const fakeReq = new Request(`http://localhost${resolvedPath}`, { method: 'GET' });
    const response = await renderRSC({ route, req: fakeReq });
    cache.set(`GET:${resolvedPath}`, response.clone());
  } catch (err) {
    console.warn(`⚠️ Preload failed for ${resolvedPath}:`, err);
  }
}

export async function preloadAll() {
  const preloadables = router.getAllRoutes().filter((r) => sampleParams[r.path]);
  await Promise.all(preloadables.map(preloadRoute));
}
