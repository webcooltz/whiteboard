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
    new Tool('Pen', 'Smooth ink', 'fas fa-pen', 'drawing', [
      {name: 'pen', description: 'Smooth ink', icon: 'fas fa-pen'}
    ]),
    new Tool('Pencil', 'Soft graphite', 'fas fa-pencil', 'drawing', [
      {name: 'pencil', description: 'Soft graphite', icon: 'fas fa-pencil'}
    ]),
    new Tool('Marker', 'Bold felt tip', 'fas fa-marker', 'drawing', [
      {name: 'marker', description: 'Bold felt tip', icon: 'fas fa-marker'}
    ]),
    new Tool('Highlighter', 'See-through highlight', 'fas fa-highlighter', 'drawing', [
      {name: 'highlighter', description: 'See-through highlight', icon: 'fas fa-highlighter'}
    ]),
    new Tool('Crayon', 'Waxy and textured', 'fas fa-paintbrush', 'drawing', [
      {name: 'crayon', description: 'Waxy and textured', icon: 'fas fa-paintbrush'}
    ]),
    new Tool('Spray', 'Spray paint', 'fas fa-spray-can', 'drawing', [
      {name: 'spraypaint', description: 'Spray paint', icon: 'fas fa-spray-can'},
    ]),
    new Tool('Line', 'Straight lines', 'fas fa-slash', 'shape', [
      {name: 'solid', description: 'Solid', icon: 'fas fa-slash'},
      {name: 'dashed', description: 'Dashed', icon: 'fas fa-slash'},
      {name: 'dotted', description: 'Dotted', icon: 'fas fa-slash'}
    ]),
    new Tool('Eraser', 'Erase drawings', 'fas fa-eraser', 'erasing', [
      {name: 'eraser', description: 'Erase drawings', icon: 'fas fa-eraser'}
    ]),
    new Tool('Text', 'Type a text box', 'fas fa-font', 'text', [
      {name: 'text', description: 'Text', icon: 'fas fa-font'}
    ]),
    // Each option is one sticker; its name is what gets placed.
    new Tool('Sticker', 'Stamp a sticker', 'fas fa-face-smile', 'sticker', [
      {name: '⭐', description: '⭐', icon: ''},
      {name: '❤️', description: '❤️', icon: ''},
      {name: '👍', description: '👍', icon: ''},
      {name: '👎', description: '👎', icon: ''},
      {name: '😀', description: '😀', icon: ''},
      {name: '😂', description: '😂', icon: ''},
      {name: '😍', description: '😍', icon: ''},
      {name: '😎', description: '😎', icon: ''},
      {name: '🤔', description: '🤔', icon: ''},
      {name: '😮', description: '😮', icon: ''},
      {name: '😢', description: '😢', icon: ''},
      {name: '🎉', description: '🎉', icon: ''},
      {name: '🔥', description: '🔥', icon: ''},
      {name: '✅', description: '✅', icon: ''},
      {name: '❌', description: '❌', icon: ''},
      {name: '❓', description: '❓', icon: ''},
      {name: '❗', description: '❗', icon: ''},
      {name: '💡', description: '💡', icon: ''},
      {name: '🚀', description: '🚀', icon: ''},
      {name: '👀', description: '👀', icon: ''},
      {name: '🐱', description: '🐱', icon: ''},
      {name: '🐶', description: '🐶', icon: ''},
      {name: '🌈', description: '🌈', icon: ''},
      {name: '☀️', description: '☀️', icon: ''},
      {name: '🍕', description: '🍕', icon: ''},
      {name: '🏆', description: '🏆', icon: ''},
      {name: '💯', description: '💯', icon: ''},
      {name: '👋', description: '👋', icon: ''}
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
