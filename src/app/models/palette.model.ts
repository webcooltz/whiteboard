import { Tool } from "./tool.model";
import { UserSelections } from "./user-selections.model";

export class Palette {
  public tools: Tool[];
  public userSelections: UserSelections;

  constructor(tools: Tool[], userSelections: UserSelections) {
    this.tools = tools;
    this.userSelections = userSelections;
  }

  // Define the list of available tools as a static property
  static availableTools: Tool[] = [
    new Tool('Pen', 'Draw using a pen tool', 'fas fa-pen', 'drawing',[
        {name: 'pen', description: 'Draw using a pen tool', icon: 'fas fa-pen'},
        {name: 'marker', description: 'Draw using a marker tool', icon: 'fas fa-highlighter'},
        {name: 'crayon', description: 'Draw using a crayon tool', icon: 'fas fa-crayon'},
        {name: 'pencil', description: 'Draw using a pencil tool', icon: 'fas fa-pencil-alt'}
      ]),
    new Tool('Eraser', 'Erase drawings', 'fas fa-eraser', 'erasing',[
      {name: 'eraser', description: 'Erase drawings', icon: 'fas fa-eraser'}
    ]), // The eraser tool has only one option
    new Tool('Line', 'Draw straight lines', 'fas fa-slash', 'shape', [
      {name: 'solid', description: 'Draw straight lines', icon: 'fas fa-slash'},
      {name: 'dotted', description: 'Draw dotted lines', icon: 'fas fa-slash'},
      {name: 'dashed', description: 'Draw dashed lines', icon: 'fas fa-slash'}
    ]),
    new Tool('Spraypaint', 'Draw using a spray tool', 'fas fa-spray-can', 'drawing', [
      {name: 'spraypaint', description: 'Draw using a spray tool', icon: 'fas fa-spray-can'},
    ]),
  ];

  // usage:
  // const availableTools = Palette.availableTools;

  /* spraypaint tool later on?:
    {name: 'airbrush', description: 'Draw using an airbrush tool', icon: 'fas fa-fan', selectedOption: false},
    {name: 'spraygun', description: 'Draw using a spray gun', icon: 'fas fa-water-gun', selectedOption: false},
  */

  /* shape tool later on:
    {name: 'rectangle', description: 'Draw rectangles', icon: 'far fa-square', selectedOption: false},
    {name: 'circle', description: 'Draw circles', icon: 'far fa-circle', selectedOption: false},
    {name: 'triangle', description: 'Draw triangles', icon: 'fas fa-caret-up', selectedOption: false}
  */
}
