import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Subscription, merge } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BoardService } from '../services/board.service';
import { PaletteService } from '../services/palette.service';
import { BoardView } from '../board/board-view';
import { InputController } from '../board/input';
import { BOARD_H, BOARD_W } from '../board/stroke';
import { GRID, shapeSlider, shapeWidth, stickerSize, stickerSlider, textSize, textSlider, toolStateFrom } from '../board/tool-state';
import { type ItemPatch } from '../board/items';
import { LINE_HEIGHT, textPad } from '../board/renderer';
import type { Stroke } from '../board/stroke';

/** A text box being typed: a new one at (x, y), or an existing one (orig) being changed. */
interface TextEditor { x: number; y: number; orig: Stroke | null; slider: number; }

@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.css']
})
export class CanvasComponent implements AfterViewInit, OnDestroy {
  @ViewChild('stage', { static: true }) stageRef!: ElementRef<HTMLDivElement>;
  @ViewChild('frame', { static: true }) frameRef!: ElementRef<HTMLDivElement>;
  @ViewChild('whiteboard', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('overlay', { static: true }) overlayRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('textField') textFieldRef?: ElementRef<HTMLTextAreaElement>;

  /** The text box being typed, in board coordinates (null when not typing). */
  editor: TextEditor | null = null;
  editorText = '';
  /** Snap-to-grid is on and a tool that uses it is picked: show the grid. */
  snapOn = false;
  readonly lineHeight = LINE_HEIGHT;
  private scale = 1; // screen pixels per board pixel

  private input: InputController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pruneTimer: any = null;
  private tokenSub?: Subscription;
  private paletteSub?: Subscription;
  private view: BoardView | null = null;

  constructor(
    public board: BoardService,
    public auth: AuthService,
    private palette: PaletteService,
    private zone: NgZone
  ) {}

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    const view = new BoardView(
      canvas.getContext('2d')!,
      this.overlayRef.nativeElement.getContext('2d')!,
      BOARD_W,
      BOARD_H
    );
    this.board.attachView(view);
    this.view = view;
    view.onSelect = (s) => this.zone.run(() => this.onSelected(s));
    this.paletteSub = this.palette.paletteChanged.subscribe((p) => {
      const name = p.userSelections.tool.name;
      // Switching away from the Text tool finishes the box being typed.
      if (this.editor && name !== 'Text') this.commitText();
      this.snapOn = !!p.userSelections.snap && ['Shape', 'UI Kit', 'Select'].includes(name);
      if (name !== 'Select') view.select(null);
      else this.restyleSelected();
    });

    // Pointer/keyboard handlers fire constantly; keep them out of Angular's change detection.
    this.zone.runOutsideAngular(() => {
      this.input = new InputController(
        canvas,
        view,
        () => toolStateFrom(this.palette.getPalette().userSelections),
        this.board.client
      );
      this.input.user = this.auth.user;
      this.input.onTextRequest = (x, y) => this.zone.run(() => this.openEditor(x, y));
      // The page hides its top bar on phones while this is set (see app.component.css).
      this.input.onItemsChange = (changes) => this.board.updateItems(changes);
      this.input.onItemsDrop = (ids) => this.board.dropItems(ids);
      this.input.onDrawing = (on) => canvas.closest('.page')?.classList.toggle('drawing', on);
      this.tokenSub = merge(this.auth.tokenChanged, this.auth.renamed).subscribe(() => { if (this.input) this.input.user = this.auth.user; });
      this.input.enabled = !this.auth.readOnly;
      this.pruneTimer = setInterval(() => view.pruneCursors(), 1000);

      // Keep the board at 16:9 and as large as the space allows.
      const stage = this.stageRef.nativeElement;
      const frame = this.frameRef.nativeElement;
      const fit = () => {
        const cs = getComputedStyle(stage);
        const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const scale = Math.min(w / BOARD_W, h / BOARD_H);
        this.scale = Math.floor(BOARD_W * scale) / BOARD_W;
        view.scale = this.scale;
        frame.style.setProperty('--cell', `${GRID * this.scale}px`);
        frame.style.width = `${Math.floor(BOARD_W * scale)}px`;
        frame.style.height = `${Math.floor(BOARD_H * scale)}px`;
      };
      this.resizeObserver = new ResizeObserver(fit);
      this.resizeObserver.observe(stage);
      fit();
    });

    // Text is drawn with the web font; repaint once it has loaded so nothing stays in the fallback font.
    document.fonts?.ready.then(() => view.redrawAll());
  }

  // The field shows the Text tool's current color, size and background, so the palette restyles it while typing.
  private get style() { return toolStateFrom(this.palette.getPalette().userSelections); }
  private get size(): number {
    const ed = this.editor;
    // An existing box keeps its exact size unless the slider is moved.
    return ed?.orig && this.palette.getPalette().userSelections.brushSize === ed.slider ? ed.orig.size : this.style.size;
  }
  get editorColor(): string { return this.style.color; }
  get editorBg(): string { return this.style.bg ?? 'transparent'; }
  get editorFontPx(): number { return this.size * this.scale; }
  get editorPadPx(): number { return textPad(this.size) * this.scale; }
  get editorLeft(): number { return this.editor ? ((this.editor.x - textPad(this.size)) / BOARD_W) * 100 : 0; }
  get editorTop(): number { return this.editor ? ((this.editor.y - textPad(this.size)) / BOARD_H) * 100 : 0; }
  // Grow the field with its text (for browsers without CSS field-sizing).
  get editorRows(): number { return this.editorText.split('\n').length; }
  get editorCols(): number { return Math.max(4, ...this.editorText.split('\n').map((l) => l.length + 1)); }

  /** The Text tool was used at (x, y): change the text box there, or start a new one. */
  private openEditor(x: number, y: number): void {
    if (this.editor) { this.commitText(); return; } // a click outside the field just finishes it
    const sel = this.palette.getPalette().userSelections;
    const orig = this.view?.textAt(x, y) ?? null;
    if (orig) {
      // Load the box's look into the palette so the color, size and background controls change it.
      sel.color = orig.color;
      sel.brushSize = textSlider(orig.size);
      sel.textBg = orig.bg ?? '';
      this.palette.setPalette(this.palette.getPalette());
      this.view?.hide(orig.id);
    }
    this.editor = orig ? { x: orig.p[0], y: orig.p[1], orig, slider: sel.brushSize } : { x, y, orig: null, slider: sel.brushSize };
    this.editorText = orig?.text ?? '';
    setTimeout(() => {
      const f = this.textFieldRef?.nativeElement;
      f?.focus();
      f?.setSelectionRange(f.value.length, f.value.length);
    });
  }

  onTextKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' && (e.key !== 'Enter' || e.shiftKey)) return;
    e.preventDefault();
    if (e.key === 'Escape') this.cancelText();
    else this.commitText();
    this.canvasRef.nativeElement.focus({ preventScroll: true }); // keyboard users carry on from the board
  }

  /** Leaving the field finishes it, except for the palette: that is how you restyle the text. */
  onTextBlur(e: FocusEvent): void {
    const to = e.relatedTarget as HTMLElement | null;
    if (to?.closest('app-palette')) return;
    this.commitText();
  }

  commitText(): void {
    const ed = this.editor;
    if (!ed) return;
    const text = this.editorText.slice(0, 500);
    const { color, bg } = this.style;
    const size = this.size;
    this.editor = null;
    this.editorText = '';
    this.view?.hide(null);
    if (!ed.orig) {
      if (text.trim()) this.input?.placeText(ed.x, ed.y, text);
      return;
    }
    const o = ed.orig;
    if (text === o.text && color === o.color && size === o.size && (bg ?? null) === (o.bg ?? null)) return;
    const { bg: _old, ...rest } = o;
    this.board.editText({ ...rest, text, color, size, ...(bg ? { bg } : {}) });
  }

  // ---- Select tool: the palette shows, and changes, whatever is picked ----
  /** What the palette said when the selection was loaded into it: later differences are the person's changes. */
  private loaded = { color: '', size: 0, fill: '', bg: '', label: '' };

  private onSelected(items: Stroke[]): void {
    if (!items.length) return;
    const sel = this.palette.getPalette().userSelections;
    const one = items.length === 1 ? items[0] : null;
    const first = items.find((s) => s.tool !== 'sticker');
    if (first) sel.color = first.color;
    if (one) sel.brushSize = one.tool === 'text' ? textSlider(one.size) : one.tool === 'sticker' ? stickerSlider(one.size) : shapeSlider(one.size);
    sel.textBg = items.find((s) => s.tool === 'text')?.bg ?? '';
    sel.fill = items.find((s) => s.tool === 'shape')?.fill ?? '';
    sel.label = one?.tool === 'shape' ? one.text ?? '' : '';
    this.loaded = { color: sel.color, size: sel.brushSize, fill: sel.fill, bg: sel.textBg, label: sel.label };
    this.palette.setPalette(this.palette.getPalette());
  }

  /** The palette was changed while items are picked: apply whatever the person changed to all of them. */
  private restyleSelected(): void {
    const items = this.view?.selection ?? [];
    const sel = this.palette.getPalette().userSelections;
    if (!items.length || sel.tool.name !== 'Select') return;
    const was = this.loaded;
    const now = { color: sel.color, size: sel.brushSize, fill: sel.fill || '', bg: sel.textBg || '', label: sel.label?.trim() || '' };
    const one = items.length === 1;
    const colorChanged = now.color !== was.color, sizeChanged = one && now.size !== was.size;
    const fillChanged = now.fill !== was.fill, bgChanged = now.bg !== was.bg, labelChanged = one && now.label !== was.label;
    if (!colorChanged && !sizeChanged && !fillChanged && !bgChanged && !labelChanged) return;
    this.loaded = now;
    const changes = items.flatMap((s) => {
      const patch: ItemPatch = {};
      if (colorChanged && s.tool !== 'sticker') patch.color = now.color;
      if (sizeChanged) patch.size = s.tool === 'text' ? textSize(now.size) : s.tool === 'sticker' ? stickerSize(now.size) : shapeWidth(now.size);
      if (s.tool === 'shape') {
        if (fillChanged) patch.fill = now.fill || null;
        if (labelChanged && s.shape !== 'arrow') patch.text = now.label || null;
      }
      if (s.tool === 'text' && bgChanged) patch.bg = now.bg || null;
      return Object.keys(patch).length ? [{ id: s.id, patch }] : [];
    });
    this.board.updateItems(changes);
  }

  private cancelText(): void {
    this.editor = null;
    this.editorText = '';
    this.view?.hide(null);
  }

  ngOnDestroy(): void {
    clearInterval(this.pruneTimer);
    this.tokenSub?.unsubscribe();
    this.paletteSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.input?.destroy();
    this.board.detachView();
  }
}
