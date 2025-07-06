// framework/navigation/router-context.tsx

'use client';
import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useEffect,
  useCallback,
} from 'react';

/**
 * RouterContext holds the current path, query, and navigation methods.
 */
type RouterContextType = {
  path: string;
  query: string;
  push: (to: string) => void;
  replace: (to: string) => void;
  prefetch: (to: string) => void;
  reload: () => void;
  back: () => void;
  forward: () => void;
};

const RouterContext = createContext<RouterContextType | null>(null);

/**
 * RouterProvider tracks URL and provides high-performance client-side navigation.
 */
export function RouterProvider({ children }: { children: React.ReactNode }) {
  const pathRef = useRef(window.location.pathname);
  const queryRef = useRef(window.location.search);

  const subscribe = (callback: () => void) => {
    const handler = () => {
      const pathname = window.location.pathname;
      const search = window.location.search;
      if (pathname !== pathRef.current || search !== queryRef.current) {
        pathRef.current = pathname;
        queryRef.current = search;
        callback();
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  };

  const [version, setVersion] = React.useState(0);
  useEffect(() => subscribe(() => setVersion((v) => v + 1)), []);

  const updateUrl = useCallback((to: string, replace = false) => {
    const url = new URL(to, window.location.origin);
    if (replace) {
      window.history.replaceState({}, '', url.toString());
    } else {
      window.history.pushState({}, '', url.toString());
    }
    pathRef.current = url.pathname;
    queryRef.current = url.search;
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const prefetched = useRef(new Map<string, number>());
  const prefetch = useCallback((to: string) => {
    const now = performance.now();
    if (prefetched.current.has(to) && now - prefetched.current.get(to)! < 5000) return;
    prefetched.current.set(to, now);
    const task = () => fetch(to, { method: 'GET', headers: { 'X-Prefetch': '1' } }).catch(() => {});
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(task);
    } else {
      setTimeout(task, 0);
    }
  }, []);

  const router: RouterContextType = useMemo(() => ({
    get path() {
      return pathRef.current;
    },
    get query() {
      return queryRef.current;
    },
    push: (to) => updateUrl(to, false),
    replace: (to) => updateUrl(to, true),
    prefetch,
    reload: () => window.location.reload(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  }), [updateUrl, prefetch]);

  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  prefetch?: boolean;
};

/**
 * Link component for client-side navigation with optional prefetching.
 */
export function Link({ to, prefetch = true, onClick, ...props }: LinkProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      e.shiftKey
    ) return;

    e.preventDefault();
    router.push(to);
    if (onClick) onClick(e);
  };

  useEffect(() => {
    if (prefetch) {
      router.prefetch(to);
    }
  }, [to, prefetch, router]);

  return <a href={to} onClick={handleClick} {...props} />;
}

/**
 * useRouter provides access to the router context.
 */
export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used inside <RouterProvider>');
  }
  return ctx;
}
