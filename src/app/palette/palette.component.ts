import { AfterViewInit, Component, ElementRef, HostListener, OnDestroy, OnInit, QueryList, ViewChildren } from '@angular/core';
import { PaletteService } from '../services/palette.service';
import { BoardService } from '../services/board.service';
import { Palette } from '../models/palette.model';
import { Subscription } from 'rxjs';
import { Tool } from '../models/tool.model';
import { ToolOption } from '../models/tool-option.model';
import { UserSelections } from '../models/user-selections.model';
import { drawStroke } from '../board/renderer';
import { toolStateFrom } from '../board/tool-state';

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
  @ViewChildren('preview') previews!: QueryList<ElementRef<HTMLCanvasElement>>;
  private previewSub?: Subscription;

  constructor(private paletteService: PaletteService, private board: BoardService) { }

  get sel(): UserSelections { return this.palette.userSelections; }
  get isSpray(): boolean { return this.sel.tool.name === 'Spray'; }
  get isPreset(): boolean { return SWATCHES.includes(this.sel.color); }
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

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (e.defaultPrevented || e.altKey || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) || document.querySelector('.backdrop')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.board.undo(); return; }
    if (e.ctrlKey || e.metaKey) return;
    const n = Number(e.key);
    if (n >= 1 && n <= this.palette.tools.length) { this.selectTool(this.palette.tools[n - 1]); return; }
    if (e.key === '[' || e.key === ']') {
      const cur = this.isSpray ? this.sel.sprayOptions.radius : this.sel.brushSize;
      this.setSize(cur + (e.key === ']' ? 1 : -1) * Math.max(1, Math.round(cur / 8)));
    }
  }

  selectTool(tool: Tool): void {
    this.sel.tool = tool;
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
    const tools = this.palette.tools.filter((t) => t.name !== 'Eraser');
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
      const color = st.color === '#ffffff' ? '#d1d5db' : st.color;
      drawStroke(g, { id: 'preview', ...st, color, seed: 7, p });
    });
  }
}
