import { LEGAL_TOKEN_PATTERN, legalLinkHref, resolveLegalToken } from '@/lib/legal';

/** The few mdast fields this transform touches (text, link and parent nodes). */
export interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

/** Class names on the `<mark>` a token becomes, so the page can style them. */
export const LEGAL_MARK_CLASS = {
  placeholder: 'legal-placeholder',
  note: 'legal-note',
} as const;

function splitText(value: string): MdNode[] {
  const out: MdNode[] = [];
  let last = 0;
  for (const match of value.matchAll(LEGAL_TOKEN_PATTERN)) {
    if (match.index > last) out.push({ type: 'text', value: value.slice(last, match.index) });
    const token = resolveLegalToken(match[0]);
    if (token.kind === 'value') {
      out.push(
        token.href
          ? { type: 'link', url: token.href, children: [{ type: 'text', value: token.text }] }
          : { type: 'text', value: token.text },
      );
    } else {
      // A text node with `hName` becomes that element (mdast-util-to-hast), keeping the text.
      out.push({
        type: 'text',
        value: token.text,
        data: { hName: 'mark', hProperties: { className: [LEGAL_MARK_CLASS[token.kind]] } },
      });
    }
    last = match.index + match[0].length;
  }
  if (last === 0) return [{ type: 'text', value }];
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
  return out;
}

function transform(node: MdNode): void {
  if (node.type === 'link' && node.url !== undefined) node.url = legalLinkHref(node.url);
  if (!node.children) return;
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text' && child.value !== undefined) return splitText(child.value);
    transform(child);
    return [child];
  });
}

/**
 * Remark plugin for docs/legal/*.md: fills `[TOKEN]` values from lib/legal.ts, turns unfilled
 * ones and `[COUNSEL: …]` notes into highlighted `<mark>`s, and points links between the
 * documents (`privacy-policy.md`) at their routes (`/privacy`).
 */
export function remarkLegal() {
  return (tree: object) => {
    transform(tree as MdNode);
  };
}
