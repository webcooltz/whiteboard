# To do

- [ ] Phone view: add a setting to turn "hide the top bar while drawing" on or off.
  Today it always slides away during a stroke on phones held upright and comes back when the stroke ends.
  The hiding is the `.page.drawing .top` rule in `src/app/app.component.css`, and `InputController.onDrawing` toggles the `drawing` class.
