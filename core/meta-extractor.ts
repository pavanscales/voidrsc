import {
  ReactNode,
  ReactElement,
  isValidElement,
  cloneElement,
} from "react";

const DEFAULT_METADATA_TAGS = new Set(["title", "meta", "link"]);

export type MetadataExtractionResult = {
  meta: ReactElement[];
  body: ReactNode[];
};

export type MetadataMatcher = (element: ReactElement) => boolean;

const defaultMatcher: MetadataMatcher = (el) =>
  typeof el.type === "string" && DEFAULT_METADATA_TAGS.has(el.type);

export function extractMetadata(
  children: ReactNode,
  matcher: MetadataMatcher = defaultMatcher
): MetadataExtractionResult {
  const meta: ReactElement[] = [];
  const body: ReactNode[] = [];
  const stack: ReactNode[] = [children];

  while (stack.length > 0) {
    const node = stack.pop();

    if (Array.isArray(node)) {
      let i = node.length;
      while (i--) stack.push(node[i]);
      continue;
    }

    if (!isValidElement(node)) {
      if (node != null) body.push(node);
      continue;
    }

    if (matcher(node)) {
      meta.push(node);
      continue;
    }

    const child = node.props?.children;
    if (!child) {
      body.push(node);
      continue;
    }

    let hasMeta = false;
    const nestedBody: ReactNode[] = [];
    const nestedStack: ReactNode[] = [child];

    while (nestedStack.length > 0) {
      const nested = nestedStack.pop();

      if (Array.isArray(nested)) {
        let j = nested.length;
        while (j--) nestedStack.push(nested[j]);
        continue;
      }

      if (!isValidElement(nested)) {
        if (nested != null) nestedBody.push(nested);
        continue;
      }

      if (matcher(nested)) {
        meta.push(nested);
        hasMeta = true;
        continue;
      }

      const inner = nested.props?.children;
      if (inner) nestedStack.push(inner);

      nestedBody.push(nested);
    }

    if (hasMeta) {
      body.push(
        cloneElement(node, { children: nestedBody })
      );
    } else {
      body.push(node);
    }
  }

  return { meta, body };
}
