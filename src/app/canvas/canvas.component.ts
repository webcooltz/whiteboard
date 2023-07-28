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
  // ---Canvas setup---
  @ViewChild('whiteboard', { static: false }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('previewCanvas', { static: false }) previewCanvasRef!: ElementRef<HTMLCanvasElement>;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private previewCanvas!: HTMLCanvasElement;
  private previewCtx!: CanvasRenderingContext2D;
  // ---Palette setup---
  palette: Palette;
  paletteChangeSub: Subscription;
  canvasChangeSub: Subscription;
  // ---Remember last selections---
  private lastColor: string = "#000000";
  private lastBrushSize: number = 5;
  private lastBrushShape: string = "round";
  private lastToolName: string = "pen";

  constructor(private paletteService: PaletteService) {
    this.palette = this.paletteService.getPalette();

    // subscribe to palette changes
    this.paletteChangeSub = this.paletteService.paletteChanged
    .subscribe(
      (palette: Palette) => {
        this.palette = palette;
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
    this.ctx.setLineDash([]); // default line dash = solid

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
      if (event.button !== 0) return; // Only draw when left mouse button is pressed (button 0
      const { offsetX, offsetY } = event;

      if (this.palette.userSelections.tool.name.toLowerCase() === 'pen' || this.palette.userSelections.tool.name.toLowerCase() === 'eraser') {
        isDrawing = true;
        lastX = offsetX;
        lastY = offsetY;

        if (this.palette.userSelections.tool.name.toLowerCase() === 'pen') {
          isLineTool = false; // For the pen tool, draw points, not lines
          if (this.palette.userSelections.tool.selectedOption.name.toLowerCase() === 'marker') {
            this.ctx.lineCap = 'square'; // For the marker tool, use a square brush shape
            this.ctx.globalCompositeOperation = 'source-over'; // Set the globalCompositeOperation to 'source-over' (default)
          }
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
      }  else {
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
        console.log("Tool is not working -- mousemove");
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
      // this.palette.userSelections.sprayOptions.density = 100; // Adjust the density of paint droplets as needed
      const ctx = this.ctx;

      for (let i = 0; i < this.palette.userSelections.sprayOptions.density; i++) {
        // Calculate random positions within the spray paint radius
        const randomX = x + (Math.random() - 0.5) * 2 * this.palette.userSelections.sprayOptions.radius;
        const randomY = y + (Math.random() - 0.5) * 2 * this.palette.userSelections.sprayOptions.radius;

        // Draw a small circle (paint droplet) at the random position
        ctx.beginPath();
        ctx.arc(randomX, randomY, 1, 0, Math.PI * 2);
        ctx.fillStyle = this.palette.userSelections.color;
        ctx.fill();
      }
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
  updateBrushShape(): void {
    switch(this.palette.userSelections.brushShape) {
      case 'round':
        this.ctx.lineCap = 'round';
        break;
      case 'square':
        this.ctx.lineCap = 'square';
        break;
      case 'butt':
        this.ctx.lineCap = 'butt';
        break;
      default:
        this.ctx.lineCap = 'round';
        break;
    }
  }
  updateLineDash(): void {
    console.log("updateLineDash(): ", this.palette.userSelections.tool.selectedOption.name.toLowerCase());
    const brushSize = this.palette.userSelections.brushSize;
    switch (this.palette.userSelections.tool.selectedOption.name.toLowerCase()) {
      case 'solid':
        this.ctx.setLineDash([]); // Make the line solid (no dash, continuous line)
        break;
      case 'dotted':
        this.ctx.setLineDash([5, 2 * brushSize]); // Make the line dotted with ___-pixel dashes and ___-pixel gaps
        break;
      case 'dashed':
        this.ctx.setLineDash([10 * brushSize/2, 5 * brushSize/2]); // Make the line dashed with ___-pixel dashes and ___-pixel gaps
        break;
      default:
        this.ctx.setLineDash([]); // Default to solid if an invalid option is provided
        break;
    }
  }
  updateUserSelections(): void {
    this.updateStrokeColor();
    this.updateBrushSize();
    this.updateBrushShape();
    this.updateLineDash();
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
      this.palette.userSelections.brushShape = "square";
      this.palette.userSelections.color = "#FFFFFF";
      this.palette.userSelections.brushSize = 10;
      this.saveLastTool();
    // if drawing tool -- spraypaint, pen, etc.
    } else if (this.palette.userSelections.tool.type.toLowerCase() === "drawing") {
      if (this.lastToolName === 'eraser') {
        this.revertToolOptions();
      }
      this.saveLastTool();
    // if line tool
    } else if (this.palette.userSelections.tool.name.toLowerCase() === "line") {
      if (this.lastToolName === 'eraser') {
        this.revertToolOptions();
      }
      this.saveLastTool();
    } else {
      console.log("Tool is not working -- updateToolSelection()");
    }
    this.updateUserSelections();
  }

  saveToolOptions(): void {
    this.lastColor = this.palette.userSelections.color;
    this.lastBrushSize = this.palette.userSelections.brushSize;
    this.lastBrushShape = this.palette.userSelections.brushShape;
  }
  revertToolOptions(): void {
    this.palette.userSelections.color = this.lastColor;
    this.palette.userSelections.brushSize = this.lastBrushSize;
    this.palette.userSelections.brushShape = this.lastBrushShape;
  }
  saveLastTool(): void {
    this.lastToolName = this.palette.userSelections.tool.name.toLowerCase();
  }
}

// todo
// -when leaving canvas, stop drawing
// -check isLineTool if it works
