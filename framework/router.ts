type RouteHandler = (req: Request, params: Record<string, string>, childResponse?: Response) => Promise<Response> | Response;
type MiddlewareNext = () => Promise<void>;
type Middleware = (req: Request, params: Record<string, string>, next: MiddlewareNext) => Promise<void> | void;

interface RouteNode {
  segment: string;
  isDynamic: boolean;
  paramName?: string;
  children: Map<string, RouteNode>;
  routeHandler?: RouteHandler;
  layoutHandler?: RouteHandler;
  middleware: Middleware[];
  isLayout: boolean;
  isGroup: boolean;
  parent?: RouteNode;
  isCatchAll: boolean;
}

class UltraRouter {
  root: RouteNode = this.createNode('', false);

  private createNode(segment: string, isDynamic: boolean = false, paramName?: string): RouteNode {
    return {
      segment,
      isDynamic,
      paramName,
      children: new Map(),
      middleware: [],
      isLayout: false,
      isGroup: false,
      isCatchAll: false,
    };
  }

  addRoute(path: string, handler: RouteHandler, options: { isLayout?: boolean, isGroup?: boolean, middleware?: Middleware[] } = {}) {
    const segments = this.parseSegments(path);
    let node = this.root;

    for (const seg of segments) {
      let child = node.children.get(seg.segment);
      if (!child) {
        child = this.createNode(seg.segment, seg.isDynamic, seg.paramName);
        child.isCatchAll = seg.isCatchAll;
        node.children.set(seg.segment, child);
        child.parent = node;
      }
      node = child;
    }

    if (options.isGroup) node.isGroup = true;
    if (options.isLayout) node.isLayout = true;
    if (options.middleware) node.middleware.push(...options.middleware);
    if (options.isLayout) node.layoutHandler = handler;
    else node.routeHandler = handler;
  }

  parseSegments(path: string): { segment: string, isDynamic: boolean, paramName?: string, isCatchAll: boolean }[] {
    return path.split('/').filter(Boolean).map(seg => {
      if (seg.startsWith('(') && seg.endsWith(')')) {
        // route group - segment ignored in URL but kept in tree
        return { segment: seg, isDynamic: false, isCatchAll: false };
      }
      if (seg.startsWith(':')) return { segment: seg, isDynamic: true, paramName: seg.slice(1), isCatchAll: false };
      if (seg.startsWith('*')) return { segment: seg, isDynamic: true, paramName: seg.slice(1), isCatchAll: true };
      return { segment: seg, isDynamic: false, isCatchAll: false };
    });
  }

  async runMiddleware(req: Request, params: Record<string, string>, middleware: Middleware[]) {
    let idx = 0;
    const next = async () => {
      if (idx < middleware.length) {
        await middleware[idx++](req, params, next);
      }
    };
    await next();
  }

  // Match and extract params (support groups and catch-all)
  match(pathname: string) {
    const segments = pathname.split('/').filter(Boolean);
    const params: Record<string, string> = {};
    const match = this.matchNode(this.root, segments, 0, params);
    if (!match) return null;

    // collect layouts chain and route
    const layouts: RouteNode[] = [];
    let node: RouteNode | undefined = match.node;
    while (node) {
      if (node.isLayout) layouts.unshift(node);
      node = node.parent;
    }

    return { routeNode: match.node, params, layouts };
  }

  private matchNode(node: RouteNode, segments: string[], idx: number, params: Record<string, string>): { node: RouteNode, params: Record<string, string> } | null {
    if (idx === segments.length) {
      if (node.routeHandler) return { node, params };
      // catch-all optional match?
      return null;
    }

    const seg = segments[idx];

    // Try exact child (ignore groups in URL)
    for (const child of node.children.values()) {
      if (child.isGroup) continue; // skip groups for URL matching

      if (!child.isDynamic && child.segment === seg) {
        const res = this.matchNode(child, segments, idx + 1, params);
        if (res) return res;
      }
    }

    // Try dynamic children
    for (const child of node.children.values()) {
      if (child.isDynamic) {
        params[child.paramName!] = seg;
        const res = this.matchNode(child, segments, idx + 1, params);
        if (res) return res;
        delete params[child.paramName!];
      }
    }

    // Try catch-all dynamic
    for (const child of node.children.values()) {
      if (child.isCatchAll) {
        params[child.paramName!] = segments.slice(idx).join('/');
        if (child.routeHandler) return { node: child, params };
        delete params[child.paramName!];
      }
    }

    return null;
  }

  async render(req: Request, pathname: string): Promise<Response | null> {
    const matched = this.match(pathname);
    if (!matched) return null;

    // Run middleware for all layouts + route in order
    for (const layoutNode of matched.layouts) {
      await this.runMiddleware(req, {}, layoutNode.middleware);
    }
    await this.runMiddleware(req, matched.params, matched.routeNode.middleware);

    // Render leaf route handler first
    let response = await matched.routeNode.routeHandler!(req, matched.params);

    // Wrap with layouts from inner to outer
    for (const layoutNode of matched.layouts.reverse()) {
      response = await layoutNode.layoutHandler!(req, matched.params, response);
    }

    return response;
  }
}
