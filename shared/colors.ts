// D15: User color palette — 10 colors for max 10 peers per room
// Applied uniformly to avatar, chat author name, and pen strokes.

export const USER_COLORS = [
  "#E63946", // red
  "#2A9D8F", // teal
  "#E9A820", // amber
  "#6A4C93", // purple
  "#1D7CF2", // blue
  "#F77F00", // orange
  "#2DC653", // green
  "#D62AD0", // magenta
  "#5C4033", // brown
  "#457B9D", // steel blue
] as const;

/** Pick the smallest unused color index from the given set of used indices */
export function pickColorIndex(usedIndices: Set<number>): number {
  for (let i = 0; i < USER_COLORS.length; i++) {
    if (!usedIndices.has(i)) return i;
  }
  return 0; // fallback (shouldn't happen with max 10 peers)
}
