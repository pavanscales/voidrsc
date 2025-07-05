import { router } from './router';
import { renderRSC } from './renderRSC';
import { cache } from './cache';

const moduleCache = new Map<string, any>();

// Sample params for dynamic routes to preload
const sampleParams: Record<string, Record<string, string>> = {
  '/': {},
  '/user/:id': { id: '1' },
};

async function preloadRoute(route: {
  path: string;
  isDynamic: boolean;
  paramNames?: string[];
  handler: any;
}) {
  const path = route.path;

  // Skip if already cached
  if (cache.get(`GET:${path}`)) return;

  let actualPath = path;

  // Replace dynamic params with sample params if dynamic route
  if (route.isDynamic && route.paramNames) {
    const params = sampleParams[path];
    if (!params) {
      // No sample params for this route — skip preloading
      return;
    }
    for (const param of route.paramNames) {
      const encoded = encodeURIComponent(params[param]);
      actualPath = actualPath.replace(`:${param}`, encoded);
    }
  }

  // Lazy load the component module for this route (optional)
  if (!moduleCache.has(actualPath)) {
    try {
      // Adjust the import path to your pages directory and extensions if needed
      const comp = await import(`../pages${actualPath}.tsx`).catch(() => null);
      moduleCache.set(actualPath, comp);
    } catch {
      moduleCache.set(actualPath, null);
    }
  }

  // Create fake request and preload the route by rendering it
  try {
    const fakeReq = new Request(`https://localhost${actualPath}`, { method: 'GET' });
    const response = await renderRSC({ route, req: fakeReq });
    // Clone response before caching
    cache.set(`GET:${actualPath}`, response.clone());
  } catch (err) {
    console.warn(`⚠️ Preload failed: ${actualPath}`, err);
  }
}

export async function preloadAll() {
  const routes = router.getAllRoutes().filter((r) => sampleParams.hasOwnProperty(r.path));
  await Promise.all(routes.map(preloadRoute));
}
