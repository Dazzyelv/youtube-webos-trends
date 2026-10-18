/**
 * How to fit the page beside the open guide. This file must not import
 * anything at runtime (the tests load it directly).
 */

const MIN_SCALE = 0.5;

/**
 * The shift and scale (origin top left) that put the page's content, which
 * starts `contentInset` px from its left edge, `gap` px past the guide's
 * right edge `guideEdge`, while its right edge stays on the screen.
 */
export function fitBesideGuide(
  viewWidth: number,
  contentInset: number,
  guideEdge: number,
  gap: number
): { shift: number; scale: number } {
  const start = guideEdge + gap;
  if (start <= contentInset) return { shift: 0, scale: 1 };
  const scale = Math.max(
    MIN_SCALE,
    (viewWidth - start) / (viewWidth - contentInset)
  );
  return { shift: viewWidth * (1 - scale), scale };
}
