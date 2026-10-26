import type { Cap, ToolKind } from './stroke';

export interface ToolState {
  tool: ToolKind;
  color: string;
  size: number;
  cap: Cap;
  dash: number[];
  radius: number;
  density: number;
}

// The bits of the palette model we read. Declared structurally so this file needs no imports.
export interface SelectionsLike {
  tool: { name: string; selectedOption: { name: string } };
  color: string;
  brushSize: number;
  brushShape: string;
  sprayOptions: { radius: number; density: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// Brush names (and the older pen sub-options marker / pencil / crayon) -> the stroke kind they draw.
const BRUSHES: Record<string, ToolKind> = { pen: 'pen', pencil: 'pencil', marker: 'marker', highlighter: 'highlighter', crayon: 'crayon' };

export function toolStateFrom(sel: SelectionsLike): ToolState {
  const name = sel.tool.name.toLowerCase();
  const option = sel.tool.selectedOption.name.toLowerCase();
  const size = clamp(sel.brushSize, 1, 100);
  let cap: Cap = sel.brushShape === 'square' || sel.brushShape === 'butt' ? sel.brushShape : 'round';
  const base = {
    color: /^#[0-9a-fA-F]{6}$/.test(sel.color) ? sel.color : '#000000',
    radius: clamp(sel.sprayOptions.radius, 1, 100),
    density: clamp(Math.round(sel.sprayOptions.density), 1, 200),
  };
  if (name === 'eraser') return { ...base, tool: 'eraser', size: clamp(size * 2, 1, 200), cap: 'round', dash: [] };
  if (name === 'spray' || name === 'spraypaint') return { ...base, tool: 'spray', size, cap, dash: [] };
  if (name === 'line') {
    const dash = option === 'dotted' ? [1, size * 2] : option === 'dashed' ? [size * 2.5, size * 2.5] : [];
    if (option === 'dotted') cap = 'round';
    return { ...base, tool: 'line', size, cap, dash };
  }
  const tool = BRUSHES[name] ?? (name === 'pen' ? BRUSHES[option] : undefined) ?? 'pen';
  return { ...base, tool, size, cap: 'round', dash: [] };
}
