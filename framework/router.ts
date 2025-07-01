type RouteHandler = (
  req: Request,
  params: Record<string, string>,
  childResponse?: Response
) => Promise<Response> | Response;

type MiddlewareNext = () => Promise<void>;
type Middleware = (
  req: Request,
  params: Record<string, string>,
  next: MiddlewareNext
) => Promise<void> | void;

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

export class UltraRouter {
  private root: RouteNode = this.createNode('', false);

  private createNode(
    segment: string,
    isDynamic = false,
    paramName?: string
  ): RouteNode {
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
      if (!child) {
        child = this.createNode(seg.segment, seg.isDynamic, seg.paramName);
        child.isCatchAll = seg.isCatchAll;
        child.parent = node;
        node.children.set(seg.segment, child);
      }
      node = child;
    }

    node.isGroup = !!options.isGroup;
    node.isLayout = !!options.isLayout;
    if (options.middleware) node.middleware.push(...options.middleware);

    if (node.isLayout) node.layoutHandler = handler;
    else node.routeHandler = handler;
  }

  private parseSegments(path: string) {
    return path
      .split('/')
      .filter(Boolean)
      .map((seg) => {
        if (seg.startsWith('(') && seg.endsWith(')'))
          return { segment: seg, isDynamic: false, isCatchAll: false };

        if (seg.startsWith('*'))
          return {
            segment: seg,
            isDynamic: true,
            paramName: seg.slice(1),
            isCatchAll: true,
          };

        if (seg.startsWith(':'))
          return {
            segment: seg,
            isDynamic: true,
            paramName: seg.slice(1),
            isCatchAll: false,
          };

        return { segment: seg, isDynamic: false, isCatchAll: false };
      });
  }

  private async runMiddleware(
    req: Request,
    params: Record<string, string>,
    middleware: Middleware[]
  ) {
    let i = 0;
    const next = async () => {
      if (i < middleware.length) await middleware[i++](req, params, next);
    };
    await next();
  }

  match(pathname: string) {
    const segments = pathname.split('/').filter(Boolean);
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
      if (child.isDynamic && !child.isCatchAll) {
        params[child.paramName!] = seg;
        const res = this.matchNode(child, segments, index + 1, params);
        if (res) return res;
        delete params[child.paramName!];
      }
    }

    for (const child of node.children.values()) {
      if (child.isCatchAll) {
        params[child.paramName!] = segments.slice(index).join('/');
        if (child.routeHandler) return { node: child, params };
        delete params[child.paramName!];
      }
    }

    return null;
  }

  async render(req: Request, pathname: string): Promise<Response | null> {
    const matched = this.match(pathname);
    if (!matched) return null;

    for (const layout of matched.layouts) {
      await this.runMiddleware(req, {}, layout.middleware);
    }

    await this.runMiddleware(req, matched.params, matched.routeNode.middleware);

    let response = await matched.routeNode.routeHandler!(req, matched.params);

    for (const layout of matched.layouts.reverse()) {
      response = await layout.layoutHandler!(req, matched.params, response);
    }

    return response;
  }
}

export const router = new UltraRouter();
