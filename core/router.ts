import { renderRSC } from './renderRSC';

export type MiddlewareNext = () => Promise<void>;
export type Middleware = (
  req: Request,
  params: Record<string, string>,
  next: MiddlewareNext
) => Promise<void> | void;

export type RouteHandler = {
  handler: (
    req: Request,
    params: Record<string, string>,
    serverData?: any
  ) => Promise<Response> | Response;
  getServerData?: (req: Request, params: Record<string, string>) => Promise<any>;
};

interface RouteNode {
  segment: string;
  isDynamic: boolean;
  isCatchAll: boolean;
  paramName?: string;
  children: Map<string, RouteNode>;
  middleware: Middleware[];
  isLayout: boolean;
  isGroup: boolean;
  parent?: RouteNode;
  routeHandler?: RouteHandler;
  layoutHandler?: RouteHandler;
}

class UltraRouter {
  private root: RouteNode = this.createNode('');
  private segmentCache = new Map<string, ReturnType<UltraRouter['parseSegments']>>();

  private createNode(segment: string, isDynamic = false, paramName?: string): RouteNode {
    return {
      segment,
      isDynamic,
      isCatchAll: false,
      paramName,
      children: new Map(),
      middleware: [],
      isLayout: false,
      isGroup: false,
    };
  }

  /**
   * Add a route or layout to the router tree
   */
  addRoute(
    path: string,
    handler: RouteHandler,
    options: { isLayout?: boolean; isGroup?: boolean; middleware?: Middleware[] } = {}
  ) {
    let segments = this.segmentCache.get(path);
    if (!segments) {
      segments = this.parseSegments(path);
      this.segmentCache.set(path, segments);
    }
    let node = this.root;

    for (const seg of segments) {
      if (seg.isCatchAll) {
        for (const c of node.children.values()) {
          if (c.isCatchAll) {
            throw new Error(`Only one catch-all allowed per level: "${path}"`);
          }
        }
      }

      let child = node.children.get(seg.segment);
      if (!child) {
        child = this.createNode(seg.segment, seg.isDynamic, seg.paramName);
        child.isCatchAll = seg.isCatchAll;
        child.parent = node;
        node.children.set(seg.segment, child);
      }
      node = child;
    }

    if (options.isLayout && node.layoutHandler) {
      throw new Error(`Duplicate layout handler at path: "${path}"`);
    }
    if (!options.isLayout && node.routeHandler) {
      throw new Error(`Duplicate route handler at path: "${path}"`);
    }

    node.isGroup = !!options.isGroup;
    node.isLayout = !!options.isLayout;
    if (options.middleware) node.middleware.push(...options.middleware);

    if (node.isLayout) node.layoutHandler = handler;
    else node.routeHandler = handler;
  }

  /**
   * Parse a route path into segments with flags for dynamic, catchAll, paramName
   */
  private parseSegments(path: string) {
    return path
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        if (seg.startsWith('(') && seg.endsWith(')')) {
          return { segment: seg, isDynamic: false, isCatchAll: false };
        }
        if (seg.startsWith('*')) {
          return { segment: seg, isDynamic: true, isCatchAll: true, paramName: seg.slice(1) };
        }
        if (seg.startsWith(':')) {
          return { segment: seg, isDynamic: true, isCatchAll: false, paramName: seg.slice(1) };
        }
        if (seg.startsWith('[') && seg.endsWith(']')) {
          const name = seg.slice(1, -1);
          const isCatchAll = name.startsWith('...');
          return {
            segment: seg,
            isDynamic: true,
            isCatchAll,
            paramName: isCatchAll ? name.slice(3) : name,
          };
        }
        return { segment: seg, isDynamic: false, isCatchAll: false };
      });
  }

  /**
   * Run middleware sequentially using a simple for-loop for clarity and better perf
   */
  private async runMiddleware(req: Request, params: Record<string, string>, middleware: Middleware[]) {
    for (let i = 0; i < middleware.length; i++) {
      let calledNext = false;
      await new Promise<void>((resolve, reject) => {
        const next = async () => {
          if (calledNext) return reject(new Error('`next()` called multiple times'));
          calledNext = true;
          resolve();
        };
        Promise.resolve(middleware[i](req, params, next)).catch(reject);
      });
      if (!calledNext && i < middleware.length - 1) {
        // If next() was never called and not last middleware, stop chain early
        break;
      }
    }
  }

  /**
   * Match a pathname against the route tree, extracting params and layouts
   */
  match(pathname: string) {
    const segments = pathname === '/' ? [] : pathname.split('/').filter(Boolean);
    const params: Record<string, string> = {};
    const match = this.matchNode(this.root, segments, 0, params);
    if (!match) {
      console.warn(`⚠️ Route not matched for "${pathname}"`);
      return null;
    }

    const layouts: RouteNode[] = [];
    let node: RouteNode | undefined = match.node;
    while (node) {
      if (node.isLayout) layouts.unshift(node);
      node = node.parent;
    }

    return { routeNode: match.node, params, layouts };
  }

  private matchNode(
    node: RouteNode,
    segments: string[],
    index: number,
    params: Record<string, string>
  ): { node: RouteNode; params: Record<string, string> } | null {
    if (index === segments.length) {
      if (node.routeHandler) return { node, params };
      return null;
    }

    const seg = segments[index];

    // Try static matches first
    for (const child of node.children.values()) {
      if (child.isGroup) continue;
      if (!child.isDynamic && child.segment === seg) {
        const res = this.matchNode(child, segments, index + 1, params);
        if (res) return res;
      }
    }

    // Then dynamic matches (non-catchAll)
    for (const child of node.children.values()) {
      if (child.isDynamic && !child.isCatchAll && child.paramName) {
        params[child.paramName] = seg;
        const res = this.matchNode(child, segments, index + 1, params);
        if (res) return res;
        delete params[child.paramName];
      }
    }

    // Finally catchAll matches
    for (const child of node.children.values()) {
      if (child.isCatchAll && child.paramName) {
        params[child.paramName] = segments.slice(index).join('/');
        if (child.routeHandler) return { node: child, params };
        delete params[child.paramName];
      }
    }

    return null;
  }

  /**
   * Render the matched route with middleware and SSR support
   */
  async render(req: Request, pathname: string): Promise<Response | null> {
    const matched = this.match(pathname);
    if (!matched) return null;

    try {
      for (const layout of matched.layouts) {
        await this.runMiddleware(req, matched.params, layout.middleware);
      }

      await this.runMiddleware(req, matched.params, matched.routeNode.middleware);

      if (!matched.routeNode.routeHandler) {
        throw new Error(`No handler found for path: ${pathname}`);
      }

      const route = matched.routeNode.routeHandler;
      return await renderRSC({
        route: {
          handler: async (req) => {
            const serverData = route.getServerData
              ? await route.getServerData(req, matched.params)
              : undefined;
            return route.handler(req, matched.params, serverData);
          },
        },
        req,
      });
    } catch (err: any) {
      console.error(`Error rendering ${pathname}:`, err);
      return new Response('Internal Server Error', { status: 500 });
    }
  }

  /**
   * Returns all registered route paths
   */
  getAllRoutes(): { path: string }[] {
    const routes: { path: string }[] = [];
    const pathParts: string[] = [];

    const traverse = (node: RouteNode) => {
      if (node.routeHandler) {
        routes.push('/' + pathParts.filter(Boolean).join('/'));
      }
      for (const child of node.children.values()) {
        pathParts.push(child.segment);
        traverse(child);
        pathParts.pop();
      }
    };

    traverse(this.root);
    return routes;
  }
}

const router = new UltraRouter();
export { UltraRouter, router };
