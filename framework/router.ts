import { renderRSC } from './render'; // ✅ Your render function

type MiddlewareNext = () => Promise<void>;
type Middleware = (
  req: Request,
  params: Record<string, string>,
  next: MiddlewareNext
) => Promise<void> | void;

type RouteHandler = {
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
  private root: RouteNode = this.createNode("");

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

  addRoute(
    path: string,
    handler: RouteHandler,
    options: {
      isLayout?: boolean;
      isGroup?: boolean;
      middleware?: Middleware[];
    } = {}
  ) {
    const segments = this.parseSegments(path);
    let node = this.root;

    for (const seg of segments) {
      let child = node.children.get(seg.segment);

      if (seg.isCatchAll) {
        for (const c of node.children.values()) {
          if (c.isCatchAll) {
            throw new Error(`Only one catch-all route allowed per path segment: "${path}"`);
          }
        }
      }

      if (!child) {
        child = this.createNode(seg.segment, seg.isDynamic, seg.paramName);
        child.isCatchAll = seg.isCatchAll;
        child.parent = node;
        node.children.set(seg.segment, child);
      }

      node = child;
    }

    if (options.isLayout && node.layoutHandler) {
      throw new Error(`Duplicate layout handler defined for path: ${path}`);
    }

    if (!options.isLayout && node.routeHandler) {
      throw new Error(`Duplicate route handler defined for path: ${path}`);
    }

    node.isGroup = !!options.isGroup;
    node.isLayout = !!options.isLayout;
    if (options.middleware) node.middleware.push(...options.middleware);

    if (node.isLayout) node.layoutHandler = handler;
    else node.routeHandler = handler;
  }

  private parseSegments(path: string) {
    return path
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        if (seg.startsWith("(") && seg.endsWith(")")) {
          return { segment: seg, isDynamic: false, isCatchAll: false };
        }
        if (seg.startsWith("*")) {
          const name = seg.slice(1);
          if (!name) throw new Error(`Catch-all must have param name: ${seg}`);
          return { segment: seg, isDynamic: true, paramName: name, isCatchAll: true };
        }
        if (seg.startsWith(":")) {
          const name = seg.slice(1);
          if (!name) throw new Error(`Dynamic segment must have param name: ${seg}`);
          return { segment: seg, isDynamic: true, paramName: name, isCatchAll: false };
        }
        return { segment: seg, isDynamic: false, isCatchAll: false };
      });
  }

  private async runMiddleware(
    req: Request,
    params: Record<string, string>,
    middleware: Middleware[]
  ) {
    let i = 0;
    const next: MiddlewareNext = async () => {
      if (i >= middleware.length) return;
      const fn = middleware[i++];
      let called = false;
      await fn(req, params, async () => {
        if (called) throw new Error("`next()` called multiple times in middleware");
        called = true;
        await next();
      });
    };
    await next();
  }

  match(pathname: string) {
    const segments = pathname.split("/").filter(Boolean);
    const params: Record<string, string> = {};
    const match = this.matchNode(this.root, segments, 0, params);
    if (!match) return null;

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

    for (const child of node.children.values()) {
      if (child.isGroup) continue;
      if (!child.isDynamic && child.segment === seg) {
        const res = this.matchNode(child, segments, index + 1, params);
        if (res) return res;
      }
    }

    for (const child of node.children.values()) {
      if (child.isDynamic && !child.isCatchAll && child.paramName) {
        params[child.paramName] = seg;
        const res = this.matchNode(child, segments, index + 1, params);
        if (res) return res;
        delete params[child.paramName];
      }
    }

    for (const child of node.children.values()) {
      if (child.isCatchAll && child.paramName) {
        params[child.paramName] = segments.slice(index).join("/");
        if (child.routeHandler) return { node: child, params };
        delete params[child.paramName];
      }
    }

    return null;
  }

  async render(req: Request, pathname: string): Promise<Response | null> {
    const matched = this.match(pathname);
    if (!matched) return null;

    try {
      for (const layout of matched.layouts) {
        await this.runMiddleware(req, matched.params, layout.middleware);
      }

      await this.runMiddleware(req, matched.params, matched.routeNode.middleware);

      if (!matched.routeNode.routeHandler) {
        throw new Error(`No route handler defined for path: ${pathname}`);
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
      console.error(`Render error for ${pathname}:`, err);
      return new Response("Internal Server Error", { status: 500 });
    }
  }

  getAllRoutes(): { path: string }[] {
    const routes: { path: string }[] = [];
    const traverse = (node: RouteNode, parts: string[] = []) => {
      if (node.routeHandler) {
        const path = "/" + parts.filter(Boolean).join("/");
        routes.push({ path });
      }
      for (const child of node.children.values()) {
        traverse(child, [...parts, child.segment]);
      }
    };
    traverse(this.root);
    return routes;
  }
}

const router = new UltraRouter();
export { UltraRouter, router };
