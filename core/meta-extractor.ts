import React, {
  ReactElement,
  ReactNode,
  isValidElement,
  cloneElement,
  Children,
} from "react";

const DEFAULT_METADATA_TAGS = new Set(["title", "meta", "link"]);

export type MetadataExtractionResult = {
  meta: ReactElement[];
  body: ReactNode[];
};

export type MetadataMatcher = (element: ReactElement) => boolean;

const defaultMatcher: MetadataMatcher = (el) =>
  typeof el.type === "string" && DEFAULT_METADATA_TAGS.has(el.type);

/**
 * Extracts metadata (e.g., <title>, <meta>, <link>) from React children.
 * Returns separated metadata and body content.
 */
export function extractMetadata(
  children: ReactNode,
  matcher: MetadataMatcher = defaultMatcher
): MetadataExtractionResult {
  const meta: ReactElement[] = [];
  const body: ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      if (child != null) body.push(child);
      return;
    }

    if (matcher(child)) {
      meta.push(child);
      return;
    }

    const childChildren = child.props?.children;
    if (childChildren) {
      const { meta: nestedMeta, body: nestedBody } = extractMetadata(childChildren, matcher);
      meta.push(...nestedMeta);
      body.push(
        nestedMeta.length > 0
          ? cloneElement(child, { ...child.props, children: nestedBody })
          : child
      );
    } else {
      body.push(child);
    }
  });

  return { meta, body };
}
