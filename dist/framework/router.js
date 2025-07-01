class Router {
    staticRoutes = new Map(); // method -> (path -> route)
    dynamicTries = new Map(); // method -> trie root
    add(method, path, handler) {
        method = method.toUpperCase();
        if (!this.staticRoutes.has(method))
            this.staticRoutes.set(method, new Map());
        if (!this.dynamicTries.has(method))
            this.dynamicTries.set(method, this.createTrieNode());
        const isDynamic = path.includes(':');
        if (!isDynamic) {
            // Static route: O(1) lookup
            this.staticRoutes.get(method).set(path, { path, isDynamic, handler });
            return;
        }
        // Dynamic route: build regex and param names (precompile)
        const segments = path.split('/').filter(Boolean);
        const paramNames = [];
        const regexStr = segments
            .map(seg => {
            if (seg.startsWith(':')) {
                paramNames.push(seg.slice(1));
                return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
            .join('/');
        const regex = new RegExp(`^/${regexStr}$`);
        const route = { path, isDynamic: true, regex, paramNames, handler };
        // Insert route into dynamic trie for the method
        this.insertIntoTrie(this.dynamicTries.get(method), segments, paramNames, route);
    }
    // Create empty trie node
    createTrieNode() {
        return { children: new Map() };
    }
    // Insert a route into trie (dynamic routes only)
    insertIntoTrie(root, segments, paramNames, route) {
        let node = root;
        for (const seg of segments) {
            const key = seg.startsWith(':') ? ':' : seg;
            if (!node.children.has(key)) {
                node.children.set(key, this.createTrieNode());
            }
            node = node.children.get(key);
            if (key === ':') {
                node.paramName = seg.slice(1);
            }
        }
        node.route = route;
    }
    match(pathname, method) {
        method = method.toUpperCase();
        // 1) Fast static route check O(1)
        const staticRoute = this.staticRoutes.get(method)?.get(pathname);
        if (staticRoute) {
            return { handler: staticRoute.handler, params: {} };
        }
        // 2) Dynamic route match using trie + regex
        const trieRoot = this.dynamicTries.get(method);
        if (!trieRoot)
            return null;
        const segments = pathname.split('/').filter(Boolean);
        const params = {};
        const matchedRoute = this.matchInTrie(trieRoot, segments, 0, params);
        if (matchedRoute) {
            // Decode params once here (cache can be added if needed)
            for (const key in params) {
                params[key] = decodeURIComponent(params[key]);
            }
            return { handler: matchedRoute.handler, params };
        }
        return null;
    }
    // Recursive trie matching
    matchInTrie(node, segments, index, params) {
        if (index === segments.length) {
            if (node.route)
                return node.route;
            return null;
        }
        const seg = segments[index];
        // 1) Try exact match child first
        const exactChild = node.children.get(seg);
        if (exactChild) {
            const found = this.matchInTrie(exactChild, segments, index + 1, params);
            if (found)
                return found;
        }
        // 2) Then try param (":") child
        const paramChild = node.children.get(':');
        if (paramChild && paramChild.paramName) {
            params[paramChild.paramName] = seg;
            const found = this.matchInTrie(paramChild, segments, index + 1, params);
            if (found)
                return found;
            // backtrack param if no match
            delete params[paramChild.paramName];
        }
        return null;
    }
    getAllRoutes() {
        const all = [];
        for (const [method, map] of this.staticRoutes.entries()) {
            for (const route of map.values()) {
                all.push({ path: route.path, handler: route.handler });
            }
        }
        // For dynamic routes, flatten trie routes
        for (const trieRoot of this.dynamicTries.values()) {
            this.collectTrieRoutes(trieRoot, '', all);
        }
        return all;
    }
    collectTrieRoutes(node, pathPrefix, collector) {
        if (node.route) {
            collector.push({ path: node.route.path, handler: node.route.handler });
        }
        for (const [segment, child] of node.children) {
            const segPart = segment === ':' ? `:${child.paramName}` : segment;
            this.collectTrieRoutes(child, pathPrefix + '/' + segPart, collector);
        }
    }
}
export const router = new Router();
