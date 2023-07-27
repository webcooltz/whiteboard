import { Component, OnDestroy, OnInit } from '@angular/core';
import { PaletteService } from '../services/palette.service';
import { Palette } from '../models/palette.model';
import { Subscription } from 'rxjs';
import { Tool } from '../models/tool.model';

@Component({
  selector: 'app-palette',
  templateUrl: './palette.component.html',
  styleUrls: ['./palette.component.css']
})
export class PaletteComponent implements OnInit, OnDestroy {
  // ---Palette setup---
  palette!: Palette;
  paletteChangeSub!: Subscription;
  // ---other vars---

  constructor(private paletteService: PaletteService) { }

  ngOnInit(): void {
    this.palette = this.paletteService.getPalette();

    this.paletteChangeSub = this.paletteService.paletteChanged
    .subscribe(
      (palette: Palette) => {
        this.palette = palette;
      }
    );
  }

  ngOnDestroy(): void {
    this.paletteChangeSub.unsubscribe();
  }

  // Handle color changes
  onColorChange(event: string) {
    console.log("onColorChange triggered");
    this.palette.userSelections.color = event;
    this.paletteService.setPalette(this.palette);
  }

  selectTool(tool: Tool): void {
    this.palette.userSelections.tool = tool;
    this.paletteService.setPalette(this.palette);
  }

  clearCanvas(): void {
    this.paletteService.clearCanvas(true);
  }

  updateBrushSize(brushSize: number): void {
    this.palette.userSelections.brushSize = brushSize;
    this.paletteService.setPalette(this.palette);
  }
}
