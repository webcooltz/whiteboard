import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { PaletteService } from '../services/palette.service';
import { Palette } from '../models/palette.model';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-canvas',
  templateUrl: './canvas.component.html',
  styleUrls: ['./canvas.component.css']
})
export class CanvasComponent implements AfterViewInit, OnDestroy {
  // ---set up canvases---
  @ViewChild('whiteboard', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas', { static: false }) previewCanvasRef!: ElementRef<HTMLCanvasElement>;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  // ---set up palette---
  palette: Palette;
  paletteChangeSub: Subscription;
  canvasChangeSub: Subscription;
  // ---other vars---
  private lastColor: string = "#000000";
  private lastBrushSize: number = 5;
  private lastToolName: string = "pen";
  private sprayPaintRadius: number = 10; // Adjust the radius as needed
  private isDrawingLine: boolean = false;

  constructor(private paletteService: PaletteService) {
    this.palette = this.paletteService.getPalette();

    // subscribe to palette changes
    this.paletteChangeSub = this.paletteService.paletteChanged
    .subscribe(
      (palette: Palette) => {
        this.palette = palette;
        // this.updateStrokeColor();
        // this.updateBrushSize();
        this.updateUserSelections();
        this.updateToolSelection();
      }
    );
    // subscribe to canvas changes (to clear)
    this.canvasChangeSub = this.paletteService.canvasStatusChanged
    .subscribe(
      (shouldCanvasBeCleared: boolean) => {
        if (shouldCanvasBeCleared) {
          this.clearAll();
        }
      }
    );
  }

  // wait for view to load before setting up canvas
  ngAfterViewInit() {
    // set up canvas
    this.canvas = this.canvasRef.nativeElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.strokeStyle = "#000000"; // default stroke color = black
    this.ctx.lineWidth = 5; // default brush size = 5

    // Initialize the preview canvas
    this.previewCanvas = this.previewCanvasRef.nativeElement;
    this.previewCtx = this.previewCanvas.getContext('2d')!;
    this.previewCanvas.style.position = 'absolute';
    this.previewCanvas.style.top = '0';
    this.previewCanvas.style.left = '0';
    this.previewCanvas.style.pointerEvents = 'none';
    this.previewCanvas.width = this.canvas.width;
    this.previewCanvas.height = this.canvas.height;

    // set up canvas drawing
    let isDrawing: boolean = false;
    let lastX: number;
    let lastY: number;
    let startX: number;
    let startY: number;
    let currentX: number;
    let currentY: number;
    let isLineTool: boolean = false;

    // when mouse is down, start drawing
    this.canvas.addEventListener('mousedown', (event) => {
      const { offsetX, offsetY } = event;

      if (this.palette.userSelections.tool.name.toLowerCase() === 'pen' || this.palette.userSelections.tool.name.toLowerCase() === 'eraser') {
        isDrawing = true;
        lastX = offsetX;
        lastY = offsetY;

        if (this.palette.userSelections.tool.name.toLowerCase() === 'pen') {
          isLineTool = false; // For the pen tool, draw points, not lines
        } else if (this.palette.userSelections.tool.name.toLowerCase() === 'eraser') {
          isLineTool = false; // The same for the eraser tool
          this.ctx.globalCompositeOperation = 'destination-out'; // Enable erasing
        }
      } else if (this.palette.userSelections.tool.name.toLowerCase() === 'line') {
        // Start drawing a line
        isDrawing = true;
        isLineTool = true;
        startX = offsetX;
        startY = offsetY;
        currentX = offsetX;
        currentY = offsetY;
        this.ctx.beginPath();
        this.ctx.moveTo(startX, startY);
      } else if (this.palette.userSelections.tool.name.toLowerCase() === 'spraypaint') {
        // Start spraying paint
        isDrawing = true;
        this.sprayPaint(event.offsetX, event.offsetY);
      } else {
        isDrawing = false;
        isLineTool = false;
      }
    });

    // when mouse is moving, draw
    this.canvas.addEventListener('mousemove', (event) => {
      if (!isDrawing) return;

      const { offsetX, offsetY } = event;

      if (isLineTool) {
        // Clear the previous preview before drawing the new one
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);

        // Draw the preview line on the preview canvas
        this.previewCtx.beginPath();
        this.previewCtx.moveTo(startX, startY);
        this.previewCtx.lineTo(offsetX, offsetY);
        this.previewCtx.stroke();

        currentX = offsetX;
        currentY = offsetY;
      } else if (this.palette.userSelections.tool.name.toLowerCase() === 'pen' || this.palette.userSelections.tool.name.toLowerCase() === 'eraser'){
        // Draw points for the pen and eraser tools
        this.ctx.beginPath();
        this.ctx.moveTo(lastX, lastY);
        this.ctx.lineTo(offsetX, offsetY);
        this.ctx.stroke();
        lastX = offsetX;
        lastY = offsetY;
      } else if (this.palette.userSelections.tool.name.toLowerCase() === 'spraypaint') {
          const { offsetX, offsetY } = event;
          // Continue spraying paint while moving the mouse
          this.sprayPaint(offsetX, offsetY);
      } else {
        isDrawing = false;
        isLineTool = false;
        console.log("Tool is not working");
      }
    });

    // when mouse is up, stop drawing
    this.canvas.addEventListener('mouseup', () => {
      if (isLineTool) {
        // Draw the final line on the main canvas
        this.ctx.lineTo(currentX, currentY);
        this.ctx.stroke();

        // Clear the preview canvas after finalizing the line
        this.previewCtx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
        isLineTool = false;
      } else if (this.palette.userSelections.tool.name.toLowerCase() === 'spraypaint') {
        isDrawing = false;
      } else {
        isDrawing = false;
        isLineTool = false;
        this.ctx.globalCompositeOperation = 'source-over'; // Reset the eraser mode if used
      }
    });
  }

  ngOnDestroy(): void {
    this.paletteChangeSub.unsubscribe();
    this.canvasChangeSub.unsubscribe();
  }

  sprayPaint(x: number, y: number): void {
    // if (this.isSpraying) {
      const density = 100; // Adjust the density of paint droplets as needed
      const ctx = this.ctx;

      for (let i = 0; i < density; i++) {
        // Calculate random positions within the spray paint radius
        const randomX = x + (Math.random() - 0.5) * 2 * this.sprayPaintRadius;
        const randomY = y + (Math.random() - 0.5) * 2 * this.sprayPaintRadius;

        // Draw a small circle (paint droplet) at the random position
        ctx.beginPath();
        ctx.arc(randomX, randomY, 1, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.userSelections.color;
        ctx.fill();
      }
    // }
  }

  // clear canvas
  clearAll(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  updateStrokeColor(): void {
    this.ctx.strokeStyle = this.palette.userSelections.color;
  }

  updateBrushSize(): void {
    this.ctx.lineWidth = this.palette.userSelections.brushSize;
  }

  updateToolSelection(): void {
    if (this.lastToolName === undefined) {
      this.lastToolName = 'pen';
      return;
    }
    if (this.lastToolName === this.palette.userSelections.tool.name.toLowerCase()) {
      return;
    }
    // if eraser
    if (this.palette.userSelections.tool.name.toLowerCase() === "eraser") {
      this.saveToolOptions();
      this.ctx.lineCap = 'square';
      this.palette.userSelections.color = "#FFFFFF";
      this.palette.userSelections.brushSize = 10;
      this.saveLastTool();
    // if drawing tool -- spraypaint, pen, etc.
    } else if (this.palette.userSelections.tool.type.toLowerCase() === "drawing") {
      if (this.lastToolName === 'eraser') {
        this.revertToolOptions();
      }
      this.ctx.lineCap = 'round';
      this.saveLastTool();
    // if line tool
    } else if (this.palette.userSelections.tool.name.toLowerCase() === "line") {
      if (this.lastToolName === 'eraser') {
        this.revertToolOptions();
      }
      this.ctx.lineCap = 'round';
      this.saveLastTool();
    } else {
      console.log("Tool is not working -- updateToolSelection()");
    }
    this.updateUserSelections();
  }

  updateUserSelections(): void {
    this.updateStrokeColor();
    this.updateBrushSize();
    // this.updateToolSelection();
  }

  saveToolOptions(): void {
    this.lastColor = this.palette.userSelections.color;
    this.lastBrushSize = this.palette.userSelections.brushSize;
  }

  revertToolOptions(): void {
    this.palette.userSelections.color = this.lastColor;
    this.palette.userSelections.brushSize = this.lastBrushSize;
  }

  saveLastTool(): void {
    this.lastToolName = this.palette.userSelections.tool.name.toLowerCase();
  }
}

// todo
// -add different line styles: dotted, dashed, square, round, etc.
// -when leaving canvas, stop drawing
