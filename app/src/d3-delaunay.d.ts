/**
 * Minimal ambient declaration for d3-delaunay — the published package resolves
 * to its JS source without bundled types in this setup. We only use the Voronoi
 * cell-polygon path, so a small surface is enough.
 */
declare module 'd3-delaunay' {
  export interface Voronoi {
    cellPolygon(i: number): number[][] | null;
  }
  export class Delaunay {
    static from(points: ArrayLike<ArrayLike<number>> | number[][]): Delaunay;
    voronoi(bounds: [number, number, number, number]): Voronoi;
  }
}
