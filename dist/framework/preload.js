import { router } from './router';
import { renderRSC } from './render';
import { cache } from './cache';
const moduleCache = new Map();
// Only preload critical sample routes (minimal I/O)
const sampleParams = {
    '/': {},
    '/user/:id': { id: '1' },
};
async function preloadRoute(route) {
    const path = route.path;
    if (cache.get(`GET:${path}`))
        return;
    let actualPath = path;
    if (route.isDynamic && route.paramNames) {
        const params = sampleParams[path];
        if (!params)
            return;
        for (const param of route.paramNames) {
            actualPath = actualPath.replace(`:${param}`, encodeURIComponent(params[param]));
        }
    }
    if (!moduleCache.has(actualPath)) {
        try {
            const comp = await import(`../pages${actualPath}.tsx`).catch(() => null);
            moduleCache.set(actualPath, comp);
        }
        catch {
            moduleCache.set(actualPath, null);
        }
    }
    try {
        const fakeReq = new Request(`https://localhost${actualPath}`, { method: 'GET' });
        const response = await renderRSC({ route, req: fakeReq });
        cache.set(`GET:${actualPath}`, response.clone());
    }
    catch (err) {
        console.warn(`⚠️ Preload failed: ${actualPath}`, err);
    }
}
export async function preloadAll() {
    const routes = router.getAllRoutes().filter((r) => Object.keys(sampleParams).includes(r.path));
    await Promise.all(routes.map(preloadRoute));
}
