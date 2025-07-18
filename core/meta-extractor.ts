import React, {
  ReactElement,
  ReactNode,
  isValidElement,
  cloneElement,
  Children,
} from "react";

// Optional tag list for metadata
const DEFAULT_METADATA_TAGS = new Set(["title", "meta", "link"]);

export type MetadataExtractionResult = {
  meta: ReactElement[];
  body: ReactNode[];
};

export type MetadataMatcher = (element: ReactElement) => boolean;

const defaultMatcher: MetadataMatcher = (el) => {
  const tag = typeof el.type === "string" ? el.type : null;
  return tag ? DEFAULT_METADATA_TAGS.has(tag) : false;
};

/**
 * Recursively extracts metadata elements (title, meta, link by default)
 * from React children and separates body content.
 */
export function extractMetadata(
  children: ReactNode,
  matcher: MetadataMatcher = defaultMatcher
): MetadataExtractionResult {
  const metaElements: ReactElement[] = [];
  const bodyElements: ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (isValidElement(child)) {
      if (matcher(child)) {
        metaElements.push(child);
      } else if (child.props?.children) {
        const { meta, body } = extractMetadata(child.props.children, matcher);

        metaElements.push(...meta);
        bodyElements.push(
          meta.length > 0
            ? cloneElement(child, { ...child.props, children: body })
            : child
        );
      } else {
        bodyElements.push(child);
      }
    } else if (child != null) {
      bodyElements.push(child);
    }
  });

  return { meta: metaElements, body: bodyElements };
}
