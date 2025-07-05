import React from "react";
import { extractMetadata } from "../framework/meta-extractor";

export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Record<string, string>;
}) {
  const { meta, body } = extractMetadata(children);

  return (
    <html lang="en">
      <head>{meta}</head>
      <body>
        <header>...</header>
        <main>{body}</main>
        <footer>...</footer>
      </body>
    </html>
  );
}
