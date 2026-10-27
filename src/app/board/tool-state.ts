import { SHAPE_DEFAULTS, type ShapeKind } from './shapes';
import type { Cap, ToolKind } from './stroke';

/** Board spacing of the snap grid. */
export const GRID = 20;

export interface ToolState {
  tool: ToolKind | 'select'; // 'select' moves existing items instead of drawing
  color: string;
  size: number;
  cap: Cap;
  dash: number[];
  radius: number;
  density: number;
  text?: string; // the sticker to place
  bg?: string; // text box background (none when missing)
  shape?: ShapeKind; // for the Shape and UI Kit tools
  fill?: string; // shape fill (none when missing)
  label?: string; // text on a new shape
  snap: number; // snap-to-grid spacing in board pixels, 0 = off
}

// The bits of the palette model we read. Declared structurally so this file needs no imports.
export interface SelectionsLike {
  tool: { name: string; selectedOption: { name: string } };
  color: string;
  brushSize: number;
  brushShape: string;
  sprayOptions: { radius: number; density: number };
  textBg?: string; // '' = no background
  fill?: string; // shape fill, '' = none
  label?: string; // text for the next wireframe piece
  snap?: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

// Brush names (and the older pen sub-options marker / pencil / crayon) -> the stroke kind they draw.
const BRUSHES: Record<string, ToolKind> = { pen: 'pen', pencil: 'pencil', marker: 'marker', highlighter: 'highlighter', crayon: 'crayon' };

/** Size slider (1-40) -> text box font size, and back. */
export const textSize = (slider: number) => clamp(12 + slider * 4, 12, 172);
export const textSlider = (size: number) => clamp(Math.round((size - 12) / 4), 1, 40);

export const stickerSize = (slider: number) => clamp(32 + slider * 8, 32, 200);
export const stickerSlider = (size: number) => clamp(Math.round((size - 32) / 8), 1, 40);
/** Shapes: the slider sets the outline thickness. */
export const shapeWidth = (slider: number) => clamp(Math.round(slider / 2), 1, 20);
export const shapeSlider = (size: number) => clamp(size * 2, 1, 40);

const SHAPES = new Set(Object.keys(SHAPE_DEFAULTS));

export function toolStateFrom(sel: SelectionsLike): ToolState {
  const name = sel.tool.name.toLowerCase();
  const option = sel.tool.selectedOption.name.toLowerCase();
  const size = clamp(sel.brushSize, 1, 100);
  let cap: Cap = sel.brushShape === 'square' || sel.brushShape === 'butt' ? sel.brushShape : 'round';
  const base = {
    snap: sel.snap ? GRID : 0,
    color: /^#[0-9a-fA-F]{6}$/.test(sel.color) ? sel.color : '#000000',
    radius: clamp(sel.sprayOptions.radius, 1, 100),
    density: clamp(Math.round(sel.sprayOptions.density), 1, 200),
  };
  // Size slider 1-40 -> font size in board pixels.
  if (name === 'text') {
    const bg = sel.textBg && /^#[0-9a-fA-F]{6}$/.test(sel.textBg) ? sel.textBg : undefined;
    return { ...base, tool: 'text', size: textSize(size), cap: 'round', dash: [], ...(bg ? { bg } : {}) };
  }
  if (name === 'select') return { ...base, tool: 'select', size, cap: 'round', dash: [] };
  if (name === 'shape' || name === 'ui kit') {
    const shape = (SHAPES.has(option) ? option : 'rect') as ShapeKind;
    const fill = sel.fill && /^#[0-9a-fA-F]{6}$/.test(sel.fill) ? sel.fill : undefined;
    const label = name === 'ui kit' ? (sel.label?.trim() || SHAPE_DEFAULTS[shape].label) : undefined;
    return { ...base, tool: 'shape', shape, size: shapeWidth(size), cap: 'round', dash: [], ...(fill ? { fill } : {}), ...(label ? { label: label.slice(0, 60) } : {}) };
  }
  if (name === 'sticker') return { ...base, tool: 'sticker', size: stickerSize(size), cap: 'round', dash: [], text: sel.tool.selectedOption.name };
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
