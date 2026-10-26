import { Injectable } from "@angular/core";
import { Palette } from '../models/palette.model';
import { Subject } from "rxjs";

@Injectable({
  providedIn: 'root'
})
export class PaletteService {

  palette: Palette = {
    tools: Palette.availableTools,
    userSelections: {
      tool: Palette.availableTools[0],
      color: "#1f2937",
      secondaryColor: "#ffffff",
      brushSize: 6,
      brushShape: "round",
      sprayOptions: {
        radius: 20,
        density: 40
      }
    }
  };

  shouldCanvasBeCleared: boolean = false;

  paletteChanged = new Subject<Palette>();
  canvasStatusChanged = new Subject<boolean>();

  constructor() {}

  getPalette(): Palette {
    return this.palette;
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.paletteChanged.next(this.palette);
  }

  clearCanvas(clearCanvas: boolean): void {
    this.shouldCanvasBeCleared = clearCanvas;
    this.canvasStatusChanged.next(this.shouldCanvasBeCleared);
    this.shouldCanvasBeCleared = false;
  }
}
