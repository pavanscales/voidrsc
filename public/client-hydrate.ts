// hydrate.tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { createFromFetch } from 'react-server-dom-webpack/client';

async function start() {
  // Fetch the server-rendered React Server Component stream
  const response = await fetch('/rsc'); // Adjust the route if needed

  // Create the React element from the RSC stream
  const rootComponent = await createFromFetch(response);

  // Hydrate into the DOM
  const root = ReactDOM.createRoot(document.getElementById('root')!);
  root.render(rootComponent);
}

start().catch((err) => {
  console.error('❌ Client hydration error:', err);
});
