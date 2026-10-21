/** A renderer-neutral SVG node: serialised by svg.ts, rendered by CharacterView. Attribute names are SVG-cased. */
export interface SvgNode {
  tag: 'g' | 'circle' | 'ellipse' | 'path' | 'rect' | 'use' | 'clipPath' | 'mask' | 'radialGradient' | 'linearGradient' | 'stop' | 'filter' | 'feGaussianBlur';
  attrs: Record<string, string | number>;
  children?: SvgNode[];
}

export const node = (tag: SvgNode['tag'], attrs: SvgNode['attrs'], children?: SvgNode[]): SvgNode => (children ? { tag, attrs, children } : { tag, attrs });

/** Drawn elements (not groups, defs or paint servers): the per-instance cost budget counts these. */
export const DRAWN: ReadonlySet<SvgNode['tag']> = new Set(['circle', 'ellipse', 'path', 'rect', 'use']);
export function countDrawn(nodes: SvgNode[]): number {
  return nodes.reduce((s, x) => s + (DRAWN.has(x.tag) ? 1 : 0) + (x.children ? countDrawn(x.children) : 0), 0);
}
