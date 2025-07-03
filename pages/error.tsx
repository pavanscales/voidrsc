export default function ErrorThrowingComponent() {
  // This will throw an error during render
  throw new Error("💥 Intentional render error in /error");
}
