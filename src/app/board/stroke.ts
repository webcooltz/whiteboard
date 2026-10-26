// Framework-free board types. Keep this folder free of Angular imports so it can be tested in plain Node/browsers.
export type ToolKind = 'pen' | 'eraser' | 'line' | 'spray';
export type Cap = 'round' | 'square' | 'butt';

export interface Stroke {
  id: string;
  user?: string;
  tool: ToolKind;
  color: string;
  size: number;
  cap: Cap;
  dash: number[];
  seed: number;
  radius: number;
  density: number;
  p: number[]; // flat [x0, y0, x1, y1, ...] in board coordinates (default 1600x900)
}

export const BOARD_W = 1600;
export const BOARD_H = 900;

export function newStrokeId(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}

export function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}
