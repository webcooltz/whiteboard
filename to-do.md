# To do

- [ ] Phone view: add a setting to turn "hide the top bar while drawing" on or off.
  Today it always slides away during a stroke on phones held upright and comes back when the stroke ends.
  The hiding is the `.page.drawing .top` rule in `src/app/app.component.css`, and `InputController.onDrawing` toggles the `drawing` class.

- [ ] Custom stickers: let people upload their own image as a sticker (resized and stored on the server, shared with everyone).
  Today the sticker picker is a fixed grid of emoji (`Palette.availableTools` in `src/app/models/palette.model.ts`).
- [ ] Select and move freehand drawings too. Select only works on text boxes, stickers and shapes today.
- [ ] Bring to front / send to back for overlapping items, and connectors that follow shapes when they move.
- [ ] Layers: let people put items on layers and move layers around (reorder, and probably show, hide or lock them), with a cap of 10 layers.
  This also covers bring to front / send to back above, which would become "move to a layer".
