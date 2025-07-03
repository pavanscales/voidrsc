export default function Layout({
  childResponse,
}: {
  childResponse: Response;
}) {
  return new Response(`<html><body><main>${await childResponse.text()}</main></body></html>`, {
    headers: { "Content-Type": "text/html" },
  });
}
