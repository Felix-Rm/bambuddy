/**
 * Pick a cols×rows packing that maximises 16:9 (or other) tile size inside a
 * fixed rectangle. Used by the Cam Wall so panes fill the window instead of
 * sitting in a fixed CSS breakpoint grid with leftover empty space.
 */

export interface CamWallLayout {
  cols: number;
  rows: number;
  tileWidth: number;
  tileHeight: number;
}

export function computeCamWallLayout(
  count: number,
  width: number,
  height: number,
  aspect = 16 / 9,
  gap = 12,
): CamWallLayout {
  if (count <= 0 || width <= 0 || height <= 0 || aspect <= 0) {
    return { cols: 1, rows: Math.max(1, count), tileWidth: 0, tileHeight: 0 };
  }

  let best: CamWallLayout & { area: number } = {
    cols: 1,
    rows: count,
    tileWidth: 0,
    tileHeight: 0,
    area: -1,
  };

  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const availW = width - gap * (cols - 1);
    const availH = height - gap * (rows - 1);
    if (availW <= 0 || availH <= 0) continue;

    let tileWidth = availW / cols;
    let tileHeight = tileWidth / aspect;
    if (tileHeight * rows > availH) {
      tileHeight = availH / rows;
      tileWidth = tileHeight * aspect;
    }

    const area = tileWidth * tileHeight;
    // Tiny epsilon so float noise does not flip between equal packings.
    if (area > best.area + 0.01) {
      best = { cols, rows, tileWidth, tileHeight, area };
    }
  }

  return {
    cols: best.cols,
    rows: best.rows,
    tileWidth: best.tileWidth,
    tileHeight: best.tileHeight,
  };
}
