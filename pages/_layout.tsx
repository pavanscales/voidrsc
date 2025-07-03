export default function RootLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Record<string, string>;
}) {
  return (
    <html>
      <head>
        <title>UltraRouter App</title>
      </head>
      <body>
        <header style={{ padding: 10, background: "#f0f0f0" }}>
          <strong>🧭 Global Layout</strong>
        </header>
        <main>{children}</main>
        <footer style={{ padding: 10, background: "#f0f0f0" }}>
          <small>© 2025 UltraRouter</small>
        </footer>
      </body>
    </html>
  );
}
