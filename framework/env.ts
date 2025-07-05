const PUBLIC_PREFIX = "VOID_PUBLIC_";

export const env = new Proxy({}, {
  get(_, key: string) {
    const value = process.env[key];
    if (!value && process.env.NODE_ENV === "production") {
      throw new Error(`[voidrsc] Missing env: ${key}`);
    }
    return value ?? "";
  }
}) as Record<string, string>;

export function getPublicEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.startsWith(PUBLIC_PREFIX))
  );
}
