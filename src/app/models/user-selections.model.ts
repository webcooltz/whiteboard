import { SprayOptions } from "./spray-options.model";
import { Tool } from "./tool.model";

export class UserSelections {
  public tool: Tool;
  public color: string;
  public secondaryColor: string;
  public brushSize: number; // 1 - 10
  public brushShape: string;
  public sprayOptions: SprayOptions;

  constructor(tool: Tool, color: string, secondaryColor: string, brushSize: number, brushShape: string, sprayOptions: SprayOptions) {
    this.tool = tool;
    this.color = color;
    this.secondaryColor = secondaryColor;
    this.brushSize = brushSize;
    this.brushShape = brushShape;
    this.sprayOptions = sprayOptions;
  }
}
