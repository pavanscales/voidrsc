import React from "react";
import { extractMetadata } from "./metadata-extractor"; // Your helper to get metadata from children

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Record<string, string>;
}) {
  // Extract metadata elements like <title>, <meta>, <link> from children
  const { meta, body } = extractMetadata(children);

  return (
    <html lang="en">
      <head>
        {/* Inject extracted metadata here */}
        {meta}
      </head>
      <body>
        <header style={{ padding: 10, background: "#f0f0f0" }}>
          <strong>🧭 UltraRouter Global Layout</strong>
        </header>
        <main>{body}</main>
        <footer style={{ padding: 10, background: "#f0f0f0" }}>
          <small>© 2025 UltraRouter</small>
        </footer>
      </body>
    </html>
  );
}
