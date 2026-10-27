import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Subscription, merge } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BoardService } from '../services/board.service';
import { PaletteService } from '../services/palette.service';
import { BoardView } from '../board/board-view';
import { InputController } from '../board/input';
import { BOARD_H, BOARD_W } from '../board/stroke';
import { toolStateFrom } from '../board/tool-state';
import { LINE_HEIGHT } from '../board/renderer';

interface TextEditor { x: number; y: number; size: number; color: string; }

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
  readonly lineHeight = LINE_HEIGHT;
  private scale = 1; // screen pixels per board pixel

  private input: InputController | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private pruneTimer: any = null;
  private tokenSub?: Subscription;

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

  get editorFontPx(): number { return this.editor ? this.editor.size * this.scale : 16; }
  // Grow the field with its text (for browsers without CSS field-sizing).
  get editorRows(): number { return this.editorText.split('\n').length; }
  get editorCols(): number { return Math.max(4, ...this.editorText.split('\n').map((l) => l.length + 1)); }

  private openEditor(x: number, y: number): void {
    if (this.editor) this.commitText(); // clicking elsewhere finishes the box being typed
    const t = toolStateFrom(this.palette.getPalette().userSelections);
    this.editor = { x, y, size: t.size, color: t.color };
    this.editorText = '';
    setTimeout(() => this.textFieldRef?.nativeElement.focus());
  }

  onTextKey(e: KeyboardEvent): void {
    if (e.key !== 'Escape' && (e.key !== 'Enter' || e.shiftKey)) return;
    e.preventDefault();
    if (e.key === 'Escape') this.editorText = '';
    this.commitText();
    this.canvasRef.nativeElement.focus({ preventScroll: true }); // keyboard users carry on from the board

  }

  commitText(): void {
    const ed = this.editor;
    if (!ed) return;
    const text = this.editorText;
    this.editor = null;
    this.editorText = '';
    if (text.trim()) this.input?.placeText(ed.x, ed.y, text.slice(0, 500));
  }

  ngOnDestroy(): void {
    clearInterval(this.pruneTimer);
    this.tokenSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.input?.destroy();
    this.board.detachView();
  }
}
