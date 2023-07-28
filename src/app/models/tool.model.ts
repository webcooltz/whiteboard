import { ToolOption } from "./tool-option.model";

export class Tool {
  public name: string;
  public description: string;
  public icon: string;
  public type: string;
  public options: ToolOption[];
  public contextMenuVisible: boolean = false;
  public selectedOption: ToolOption;

  constructor(name: string, description: string, icon: string, type: string, options: ToolOption[], contextMenuVisible: boolean = false, selectedOption: ToolOption = options[0]) {
    this.name = name;
    this.description = description;
    this.icon = icon;
    this.type = type;
    this.options = options;
    this.contextMenuVisible = contextMenuVisible;
    this.selectedOption = selectedOption;
  }
}
