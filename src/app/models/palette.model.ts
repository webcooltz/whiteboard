import { Tool } from "./tool.model";
import { UserSelections } from "./user-selections.model";

export class Palette {
  public tools: Tool[];
  public colors: string[];
  public userSelections: UserSelections;

  constructor(tools: Tool[], userSelections: UserSelections, colors: string[]) {
    this.tools = tools;
    this.userSelections = userSelections;
    this.colors = colors;
  }

  // Define the list of available tools as a static property
  static availableTools: Tool[] = [
    new Tool('Pen', 'Draw using a pen tool', 'fas fa-pen', 'drawing'),
    new Tool('Eraser', 'Erase drawings', 'fas fa-eraser', 'erasing'), // maybe change to drawing
    new Tool('Line', 'Draw straight lines', 'fas fa-slash', 'shape'),
    new Tool('Spraypaint', 'Draw using a spray tool', 'fas fa-spray-can', 'drawing'),
  ];

  // usage:
  // const availableTools = Palette.availableTools;

  static availableColors: string[] = [
    '#000000', // black
    '#808080', // gray
    '#C0C0C0', // silver
    '#FFFFFF', // white
    '#FF0000' // red
  ];
}
