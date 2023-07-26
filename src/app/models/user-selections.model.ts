import { Tool } from "./tool.model";

export class UserSelections {
  public tool: Tool;
  public color: string;
  public secondaryColor: string;
  public brushSize: number; // 1 - 10

  constructor(tool: Tool, color: string, secondaryColor: string, brushSize: number) {
    this.tool = tool;
    this.color = color;
    this.secondaryColor = secondaryColor;
    this.brushSize = brushSize;
  }
}
