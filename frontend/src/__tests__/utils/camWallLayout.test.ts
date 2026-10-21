import { describe, it, expect } from 'vitest';
import { computeCamWallLayout } from '../../utils/camWallLayout';

describe('computeCamWallLayout', () => {
  it('returns empty tiles for invalid inputs', () => {
    expect(computeCamWallLayout(0, 800, 600).tileWidth).toBe(0);
    expect(computeCamWallLayout(4, 0, 600).tileWidth).toBe(0);
  });

  it('fills a 16:9 viewport with a single pane', () => {
    const layout = computeCamWallLayout(1, 1920, 1080, 16 / 9, 0);
    expect(layout.cols).toBe(1);
    expect(layout.rows).toBe(1);
    expect(layout.tileWidth).toBeCloseTo(1920, 0);
    expect(layout.tileHeight).toBeCloseTo(1080, 0);
  });

  it('packs four panes as 2×2 in a 16:9 viewport', () => {
    const layout = computeCamWallLayout(4, 1920, 1080, 16 / 9, 0);
    expect(layout.cols).toBe(2);
    expect(layout.rows).toBe(2);
    expect(layout.tileWidth).toBeCloseTo(960, 0);
    expect(layout.tileHeight).toBeCloseTo(540, 0);
  });

  it('prefers the packing with the largest tile area', () => {
    // Wide short strip: one row of three beats a taller 2-column stack.
    const layout = computeCamWallLayout(3, 1200, 300, 16 / 9, 0);
    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(1);
    expect(layout.tileWidth / layout.tileHeight).toBeCloseTo(16 / 9, 5);
  });

  it('keeps the aspect ratio when height-constrained', () => {
    const layout = computeCamWallLayout(2, 800, 200, 16 / 9, 0);
    expect(layout.tileWidth / layout.tileHeight).toBeCloseTo(16 / 9, 5);
    expect(layout.tileHeight * layout.rows).toBeLessThanOrEqual(200 + 0.01);
  });

  it('accounts for gaps between panes', () => {
    const withGap = computeCamWallLayout(2, 820, 400, 16 / 9, 20);
    const noGap = computeCamWallLayout(2, 820, 400, 16 / 9, 0);
    expect(withGap.tileWidth).toBeLessThan(noGap.tileWidth);
  });
});
