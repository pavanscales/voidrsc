// framework/navigation/router-context.tsx

'use client';
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

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

export function RouterProvider({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  const [query, setQuery] = useState(window.location.search);

  useEffect(() => {
    const onPopState = () => {
      setPath(window.location.pathname);
      setQuery(window.location.search);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const updateUrl = useCallback((to: string, replace = false) => {
    const url = new URL(to, window.location.origin);
    if (replace) window.history.replaceState({}, '', to);
    else window.history.pushState({}, '', to);
    setPath(url.pathname);
    setQuery(url.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  // Simple prefetch cache to avoid duplicate fetches
  const prefetched = React.useRef(new Set<string>());
  const prefetch = useCallback((to: string) => {
    if (prefetched.current.has(to)) return;
    prefetched.current.add(to);
    // Customize prefetch logic as needed
    fetch(to, { method: 'GET', headers: { 'X-Prefetch': '1' } }).catch(() => {});
  }, []);

  const router: RouterContextType = {
    path,
    query,
    push: (to) => updateUrl(to, false),
    replace: (to) => updateUrl(to, true),
    prefetch,
    reload: () => window.location.reload(),
    back: () => window.history.back(),
    forward: () => window.history.forward(),
  };

  return <RouterContext.Provider value={router}>{children}</RouterContext.Provider>;
}

type LinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  to: string;
  prefetch?: boolean;
};

export function Link({ to, prefetch = true, onClick, ...props }: LinkProps) {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (
      e.defaultPrevented ||
      e.metaKey ||
      e.altKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.button !== 0
    )
      return;

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

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) {
    throw new Error('useRouter must be used inside <RouterProvider>');
  }
  return ctx;
}
