type RouteHandler = (req: Request, params: Record<string, string>) => Promise<Response> | Response;

type Route = {
  path: string;
  isDynamic: boolean;
  regex?: RegExp;
  paramNames?: string[];
  handler: RouteHandler;
};

type TrieNode = {
  children: Map<string, TrieNode>;
  route?: Route;
  paramName?: string; // For param segment nodes (like ":id")
};

class Router {
  private staticRoutes: Map<string, Map<string, Route>> = new Map(); // method -> (path -> route)
  private dynamicTries: Map<string, TrieNode> = new Map(); // method -> trie root node

  add(method: string, path: string, handler: RouteHandler) {
    method = method.toUpperCase();

    if (!this.staticRoutes.has(method)) this.staticRoutes.set(method, new Map());
    if (!this.dynamicTries.has(method)) this.dynamicTries.set(method, this.createTrieNode());

    const isDynamic = path.includes(':');

    if (!isDynamic) {
      // Static route: direct map for O(1) lookup
      this.staticRoutes.get(method)!.set(path, { path, isDynamic, handler });
      return;
    }

    // Dynamic route: create regex and param names, then insert in trie
    const segments = path.split('/').filter(Boolean);
    const paramNames: string[] = [];
    const regexStr = segments
      .map(seg => {
        if (seg.startsWith(':')) {
          paramNames.push(seg.slice(1));
          return '([^/]+)'; // Match any non-slash chars for param
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex specials
      })
      .join('/');
    const regex = new RegExp(`^/${regexStr}$`);

    const route: Route = { path, isDynamic: true, regex, paramNames, handler };

    this.insertIntoTrie(this.dynamicTries.get(method)!, segments, paramNames, route);
  }

  private createTrieNode(): TrieNode {
    return { children: new Map() };
  }

  private insertIntoTrie(root: TrieNode, segments: string[], paramNames: string[], route: Route) {
    let node = root;
    for (const seg of segments) {
      const key = seg.startsWith(':') ? ':' : seg;
      if (!node.children.has(key)) {
        node.children.set(key, this.createTrieNode());
      }
      node = node.children.get(key)!;
      if (key === ':') {
        node.paramName = seg.slice(1);
      }
    }
    node.route = route;
  }

  match(pathname: string, method: string): { handler: RouteHandler; params: Record<string, string> } | null {
    method = method.toUpperCase();

    // 1) Check static routes first (fast path)
    const staticRoute = this.staticRoutes.get(method)?.get(pathname);
    if (staticRoute) {
      return { handler: staticRoute.handler, params: {} };
    }

    // 2) Match dynamic routes via trie
    const trieRoot = this.dynamicTries.get(method);
    if (!trieRoot) return null;

    const segments = pathname.split('/').filter(Boolean);
    const params: Record<string, string> = {};

    const matchedRoute = this.matchInTrie(trieRoot, segments, 0, params);
    if (matchedRoute) {
      // Decode URI components for params
      for (const key in params) {
        params[key] = decodeURIComponent(params[key]);
      }
      return { handler: matchedRoute.handler, params };
    }

    return null;
  }

  private matchInTrie(node: TrieNode, segments: string[], index: number, params: Record<string, string>): Route | null {
    if (index === segments.length) {
      return node.route ?? null;
    }

    const seg = segments[index];

    // Try exact segment child first
    const exactChild = node.children.get(seg);
    if (exactChild) {
      const found = this.matchInTrie(exactChild, segments, index + 1, params);
      if (found) return found;
    }

    // Then try param child (':')
    const paramChild = node.children.get(':');
    if (paramChild && paramChild.paramName) {
      params[paramChild.paramName] = seg;
      const found = this.matchInTrie(paramChild, segments, index + 1, params);
      if (found) return found;
      // Backtrack param if no match
      delete params[paramChild.paramName];
    }

    return null;
  }

  // Get all registered routes (static + dynamic)
  getAllRoutes(): Route[] {
    const all: Route[] = [];

    // Collect all static routes
    for (const methodRoutes of this.staticRoutes.values()) {
      for (const route of methodRoutes.values()) {
        all.push(route);
      }
    }

    // Collect all dynamic routes by traversing tries
    for (const trieRoot of this.dynamicTries.values()) {
      this.collectTrieRoutes(trieRoot, all);
    }

    return all;
  }

  private collectTrieRoutes(node: TrieNode, collector: Route[]) {
    if (node.route) {
      collector.push(node.route);
    }
    for (const child of node.children.values()) {
      this.collectTrieRoutes(child, collector);
    }
  }
}

export const router = new Router();
