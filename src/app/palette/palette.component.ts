import { Component, OnDestroy, OnInit } from '@angular/core';
import { PaletteService } from '../services/palette.service';
import { Palette } from '../models/palette.model';
import { Subscription } from 'rxjs';
import { Tool } from '../models/tool.model';
import { ToolOption } from '../models/tool-option.model';

@Component({
  selector: 'app-palette',
  templateUrl: './palette.component.html',
  styleUrls: ['./palette.component.css']
})
export class PaletteComponent implements OnInit, OnDestroy {
  // ---Palette setup---
  palette!: Palette;
  paletteChangeSub!: Subscription;

  constructor(private paletteService: PaletteService) { }

  ngOnInit(): void {
    this.palette = this.paletteService.getPalette();

    this.paletteChangeSub = this.paletteService.paletteChanged
    .subscribe(
      (palette: Palette) => {
        this.palette = palette;
      }
    );

    this.palette.userSelections.tool.contextMenuVisible = true;
  }

  ngOnDestroy(): void {
    this.paletteChangeSub.unsubscribe();
  }

  // Handle color changes
  onColorChange(event: string) {
    this.palette.userSelections.color = event;
    this.paletteService.setPalette(this.palette);
  }

  selectTool(tool: Tool): void {
    this.palette.userSelections.tool = tool;
    this.palette.userSelections.tool.contextMenuVisible = true;
    this.paletteService.setPalette(this.palette);
  }

  selectToolOption(toolOption: ToolOption): void {
    this.palette.userSelections.tool.selectedOption = toolOption;
    this.paletteService.setPalette(this.palette);
  }

  clearCanvas(): void {
    this.paletteService.clearCanvas(true);
  }

  updateBrushSize(brushSize: number): void {
    this.palette.userSelections.brushSize = brushSize;
    this.paletteService.setPalette(this.palette);
  }

  updateBrushShape(brushShape: string): void {
    this.palette.userSelections.brushShape = brushShape;
    this.paletteService.setPalette(this.palette);
  }

  updateSprayRadius(radius: number): void {
    this.palette.userSelections.sprayOptions.radius = radius;
    this.paletteService.setPalette(this.palette);
  }

  updateSprayDensity(density: number): void {
    this.palette.userSelections.sprayOptions.density = density;
    this.paletteService.setPalette(this.palette);
  }
}

// to-do
// -user can eventually set different options for each tool -- color, size, etc.
// -add paintbrushes
// -custom brush shape -- user can upload image or draw shape
    // -draw shape: user can draw shape in a mini canvas (shape editor/picker)
// -add text tool
// -add image upload/manipulation
