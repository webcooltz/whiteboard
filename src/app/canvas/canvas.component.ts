import { AfterViewInit, Component, ElementRef, NgZone, OnDestroy, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { BoardService } from '../services/board.service';
import { PaletteService } from '../services/palette.service';
import { BoardView } from '../board/board-view';
import { InputController } from '../board/input';
import { BOARD_H, BOARD_W } from '../board/stroke';
import { toolStateFrom } from '../board/tool-state';

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
      this.tokenSub = this.auth.tokenChanged.subscribe(() => { if (this.input) this.input.user = this.auth.user; });
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
        frame.style.width = `${Math.floor(BOARD_W * scale)}px`;
        frame.style.height = `${Math.floor(BOARD_H * scale)}px`;
      };
      this.resizeObserver = new ResizeObserver(fit);
      this.resizeObserver.observe(stage);
      fit();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.pruneTimer);
    this.tokenSub?.unsubscribe();
    this.resizeObserver?.disconnect();
    this.input?.destroy();
    this.board.detachView();
  }
}
