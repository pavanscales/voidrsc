// hydrate.tsx
import { createRoot } from 'react-dom/client';
import { createFromFetch } from 'react-server-dom-webpack/client';

async function hydrate() {
  const response = await fetch('/rsc', {
    headers: { Accept: 'text/x-component' },
  });

  const rootComponent = await createFromFetch(response);
  const root = createRoot(document.getElementById('root')!);
  root.render(rootComponent);
}

hydrate().catch((err) => {
  console.error('❌ Hydration failed:', err);
});
