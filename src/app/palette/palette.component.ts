import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { PaletteService } from '../services/palette.service';
import { BoardService } from '../services/board.service';
import { Palette } from '../models/palette.model';
import { Subscription } from 'rxjs';
import { Tool } from '../models/tool.model';
import { ToolOption } from '../models/tool-option.model';
import { UserSelections } from '../models/user-selections.model';
import { drawStroke } from '../board/renderer';
import type { ToolKind } from '../board/stroke';
import type { Align } from '../board/items';
import { toolStateFrom } from '../board/tool-state';

const NO_PREVIEW = new Set(['Eraser', 'Text', 'Sticker', 'Select', 'Shape', 'UI Kit']); // these tiles show an icon instead of a sample stroke
// Text box backgrounds: sticky-note tints plus white and dark ('' = none).
const TEXT_BGS = ['#fef08a', '#fed7aa', '#fbcfe8', '#e9d5ff', '#bfdbfe', '#bbf7d0', '#ffffff', '#1f2937'];
// Tools past the tenth have a letter instead of a number.
const ALIGNS: [Align, string][] = [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const LETTER_TOOLS: Record<string, string> = { v: 'Select', r: 'Shape', k: 'UI Kit' };
const SWATCHES = ['#1f2937', '#ffffff', '#9ca3af', '#ef4444', '#f97316', '#facc15', '#22c55e', '#3b82f6', '#6366f1', '#a855f7', '#ec4899'];

@Component({
  selector: 'app-palette',
  templateUrl: './palette.component.html',
  styleUrls: ['./palette.component.css']
})
export class PaletteComponent implements OnInit, AfterViewInit, OnDestroy {
  palette!: Palette;
  paletteChangeSub!: Subscription;
  swatches = SWATCHES;
  textBgs = TEXT_BGS;
  aligns = ALIGNS;
  @ViewChildren('preview') previews!: QueryList<ElementRef<HTMLCanvasElement>>;
  private previewSub?: Subscription;

  constructor(private paletteService: PaletteService, public board: BoardService) { }

  get sel(): UserSelections { return this.palette.userSelections; }
  get isSpray(): boolean { return this.sel.tool.name === 'Spray'; }
  get isPreset(): boolean { return SWATCHES.includes(this.sel.color); }
  /** What the controls below are for: the tool in use, or (with Select) whatever is picked on the board. */
  get kind(): 'draw' | 'eraser' | 'text' | 'sticker' | 'shape' | 'multi' | 'none' {
    const name = this.sel.tool.name;
    if (name === 'Eraser') return 'eraser';
    if (name === 'Text') return 'text';
    if (name === 'Sticker') return 'sticker';
    if (name === 'Shape' || name === 'UI Kit') return 'shape';
    if (name !== 'Select') return 'draw';
    if (this.board.selection.length > 1) return 'multi';
    const t = this.board.selected?.tool;
    return t === 'text' || t === 'sticker' || t === 'shape' ? t : 'none';
  }
  get isText(): boolean { return this.kind === 'text'; }
  get isSticker(): boolean { return this.kind === 'sticker'; }
  get isSelectTool(): boolean { return this.sel.tool.name === 'Select'; }
  get isStickerTool(): boolean { return this.sel.tool.name === 'Sticker'; }
  /** Shape and UI Kit pick their piece from a grid of chips. */
  get isChips(): boolean { return this.sel.tool.name === 'Shape' || this.sel.tool.name === 'UI Kit'; }
  get showColor(): boolean { return ['draw', 'text', 'shape', 'multi'].includes(this.kind); }
  get showFill(): boolean { return ['text', 'shape', 'multi'].includes(this.kind); }
  get showSelection(): boolean { return this.isSelectTool && this.board.selection.length > 0; }
  get showLabel(): boolean {
    const s = this.board.selected;
    return this.sel.tool.name === 'UI Kit' || (this.isSelectTool && s?.tool === 'shape' && s.shape !== 'arrow');
  }
  get showSnap(): boolean { return this.isChips || this.isSelectTool; }
  get fillValue(): string { return (this.kind === 'text' ? this.sel.textBg : this.sel.fill) || ''; }
  /** The emoji shown beside the size slider. */
  get stickerGlyph(): string { return this.isStickerTool ? this.sel.tool.selectedOption.name : this.board.selected?.text ?? ''; }
  hotkey(tool: Tool, i: number): string {
    if (i < 10) return String((i + 1) % 10);
    return Object.entries(LETTER_TOOLS).find(([, name]) => name === tool.name)?.[0].toUpperCase() ?? '';
  }
  hasPreview(tool: Tool): boolean { return !NO_PREVIEW.has(tool.name); }
  /** On-screen size of the brush, roughly as it appears on a full-width board. */
  get dotPx(): number {
    const s = this.isSpray ? this.sel.sprayOptions.radius * 2 : this.sel.tool.name === 'Eraser' ? this.sel.brushSize * 2 : this.sel.brushSize;
    return Math.max(3, Math.min(40, s * 0.8));
  }

  ngOnInit(): void {
    this.palette = this.paletteService.getPalette();
    this.paletteChangeSub = this.paletteService.paletteChanged.subscribe((palette: Palette) => {
      this.palette = palette;
      this.drawPreviews();
    });
  }

  ngAfterViewInit(): void {
    this.drawPreviews();
    this.previewSub = this.previews.changes.subscribe(() => this.drawPreviews());
  }

  ngOnDestroy(): void {
    this.paletteChangeSub.unsubscribe();
    this.previewSub?.unsubscribe();
  }

  // Tapping a palette button while typing a text box would take focus from the text field; keep it there.
  @HostListener('mousedown', ['$event'])
  keepTextFocus(e: MouseEvent): void {
    if (document.activeElement?.classList.contains('text-field') && (e.target as HTMLElement).closest('button')) e.preventDefault();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || document.querySelector('.backdrop')) return;
    const key = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (key === 'y' || (e.shiftKey && key === 'z'))) { e.preventDefault(); this.board.redo(); return; }
    if ((e.ctrlKey || e.metaKey) && key === 'z') { e.preventDefault(); this.board.undo(); return; }
    if (e.ctrlKey || e.metaKey) {
      const picked = this.isSelectTool && this.board.selection.length > 0;
      if (key === 'a' && this.isSelectTool) { e.preventDefault(); this.board.selectAll(); }
      else if (key === 'c' && picked) { e.preventDefault(); this.board.copySelection(); }
      else if (key === 'x' && picked) { e.preventDefault(); this.board.cutSelection(); }
      else if (key === 'd' && picked) { e.preventDefault(); this.board.duplicateSelection(); }
      else if (key === 'g' && picked) { e.preventDefault(); if (e.shiftKey) this.board.ungroupSelection(); else this.board.groupSelection(); }
      else if (key === 'v' && this.board.hasClipboard()) { e.preventDefault(); this.pasteNow(); }
      return;
    }
    if (e.key === 'Delete' && this.isSelectTool && this.board.selection.length) { e.preventDefault(); this.board.deleteSelection(); return; }
    const letterTool = LETTER_TOOLS[key];
    if (letterTool) { const tool = this.palette.tools.find((x) => x.name === letterTool); if (tool) this.selectTool(tool); return; }
    const n = e.key === '0' ? 10 : Number(e.key);
    if (n >= 1 && n <= this.palette.tools.length) { this.selectTool(this.palette.tools[n - 1]); return; }
    if (e.key === '[' || e.key === ']') {
      const cur = this.isSpray ? this.sel.sprayOptions.radius : this.sel.brushSize;
      this.setSize(cur + (e.key === ']' ? 1 : -1) * Math.max(1, Math.round(cur / 8)));
    }
  }

  selectTool(tool: Tool): void {
    this.sel.tool = tool;
    this.sel.label = '';
    this.paletteService.setPalette(this.palette);
  }

  selectToolOption(toolOption: ToolOption): void {
    this.sel.tool.selectedOption = toolOption;
    this.paletteService.setPalette(this.palette);
  }

  setColor(color: string): void {
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    this.sel.color = color.toLowerCase();
    this.paletteService.setPalette(this.palette);
  }

  /** Fill for shapes, background for text boxes; with a mix selected, both. */
  setFill(c: string): void {
    if (this.kind === 'text') return this.setTextBg(c);
    this.sel.fill = c;
    if (this.kind === 'multi') this.sel.textBg = c;
    this.paletteService.setPalette(this.palette);
  }

  /** Paste switches to the Select tool first, so the pasted items stay selected. */
  pasteNow(): void {
    if (!this.board.hasClipboard()) return;
    const select = this.palette.tools.find((t) => t.name === 'Select');
    if (select && this.sel.tool !== select) this.selectTool(select);
    this.board.paste();
  }

  setLabel(text: string): void {
    this.sel.label = text;
    this.paletteService.setPalette(this.palette);
  }

  setSnap(on: boolean): void {
    this.sel.snap = on;
    this.paletteService.setPalette(this.palette);
  }

  setTextBg(bg: string): void {
    this.sel.textBg = bg;
    this.paletteService.setPalette(this.palette);
  }

  setSize(size: number): void {
    if (this.isSpray) this.sel.sprayOptions.radius = Math.max(1, Math.min(60, size));
    else this.sel.brushSize = Math.max(1, Math.min(40, size));
    this.paletteService.setPalette(this.palette);
  }

  updateSprayDensity(density: number): void {
    this.sel.sprayOptions.density = density;
    this.paletteService.setPalette(this.palette);
  }

  /** Draw a sample stroke of each brush, with the real renderer, in the current color. */
  private drawPreviews(): void {
    if (!this.previews) return;
    const tools = this.palette.tools.filter((t) => this.hasPreview(t));
    this.previews.forEach((ref, i) => {
      const tool = tools[i];
      const c = ref.nativeElement, g = c.getContext('2d');
      if (!tool || !g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      g.scale(c.width / 56, c.height / 24);
      const st = toolStateFrom({ ...this.sel, tool, brushSize: tool.name === 'Highlighter' ? 3 : tool.name === 'Crayon' ? 5 : 3,
        sprayOptions: { radius: 5, density: 7 } });
      const p: number[] = [];
      if (st.tool === 'line') p.push(6, 18, 50, 6);
      else for (let x = 6; x <= 50; x += 1.5) p.push(x, 12 + Math.sin((x - 6) / 7) * 6);
      if (st.tool === 'select') return;
      const color = st.color === '#ffffff' ? '#d1d5db' : st.color;
      drawStroke(g, { id: 'preview', ...st, tool: st.tool as ToolKind, color, seed: 7, p });
    });
  }
}
