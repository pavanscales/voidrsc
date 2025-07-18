// framework/navigation/router-context.tsx

'use client';
import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  useState,
} from 'react';

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

function isBrowser() {
  return typeof window !== 'undefined';
}

/**
 * RouterProvider tracks URL and provides high-performance client-side navigation.
 */
export function RouterProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe initial state
  const [location, setLocation] = useState(() => ({
    path: isBrowser() ? window.location.pathname : '/',
    query: isBrowser() ? window.location.search : '',
  }));

  // Keep refs in sync for fast access without causing re-renders
  const pathRef = useRef(location.path);
  const queryRef = useRef(location.query);

  // Subscribe to popstate events
  const subscribe = useCallback((callback: () => void) => {
    if (!isBrowser()) return () => {};

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
  }, []);

  // Sync React state on URL changes to trigger re-renders
  useEffect(() => {
    const cleanup = subscribe(() => {
      setLocation({ path: pathRef.current, query: queryRef.current });
    });
    return cleanup;
  }, [subscribe]);

  // Update URL and dispatch popstate event
  const updateUrl = useCallback(
    (to: string, replace = false, scroll = true) => {
      if (!isBrowser()) return;
      const url = new URL(to, window.location.origin);

      if (replace) {
        window.history.replaceState({}, '', url.toString());
      } else {
        window.history.pushState({}, '', url.toString());
      }

      pathRef.current = url.pathname;
      queryRef.current = url.search;
      window.dispatchEvent(new PopStateEvent('popstate'));

      if (scroll) window.scrollTo(0, 0);
    },
    []
  );

  // Prefetch cache with expiry and idle callback scheduling
  const prefetched = useRef(new Map<string, number>());
  const prefetch = useCallback((to: string) => {
    if (!isBrowser()) return;
    const now = performance.now();

    if (prefetched.current.has(to) && now - prefetched.current.get(to)! < 5000) return;

    prefetched.current.set(to, now);

    const task = () =>
      fetch(to, { method: 'GET', headers: { 'X-Prefetch': '1' } }).catch(() => {});

    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(task);
    } else {
      setTimeout(task, 0);
    }
  }, []);

  // Stable router object with getters to avoid unnecessary re-renders
  const router = useMemo(
    () => ({
      get path() {
        return pathRef.current;
      },
      get query() {
        return queryRef.current;
      },
      push: (to: string) => updateUrl(to, false),
      replace: (to: string) => updateUrl(to, true),
      prefetch,
      reload: () => isBrowser() && window.location.reload(),
      back: () => isBrowser() && window.history.back(),
      forward: () => isBrowser() && window.history.forward(),
    }),
    [updateUrl, prefetch]
  );

  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  prefetch?: boolean;
  target?: React.HTMLAttributeAnchorTarget;
};

/**
 * Link component for client-side navigation with optional prefetching and accessibility improvements.
 */
export function Link({ to, prefetch = true, onClick, target, rel, ...props }: LinkProps) {
  const router = useRouter();

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      // Ignore if modified click or right click or external link
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.altKey ||
        e.ctrlKey ||
        e.shiftKey ||
        (target && target !== '_self')
      )
        return;

      e.preventDefault();
      router.push(to);
      if (onClick) onClick(e);
    },
    [router, to, onClick, target]
  );

  // Prefetch on mount or when `to` changes
  useEffect(() => {
    if (prefetch) router.prefetch(to);
  }, [to, prefetch, router]);

  // Auto add rel for security on external links
  const isExternal = to.startsWith('http') || to.startsWith('//');
  const safeRel = isExternal ? rel ?? 'noopener noreferrer' : rel;

  return <a href={to} onClick={handleClick} target={target} rel={safeRel} {...props} />;
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
