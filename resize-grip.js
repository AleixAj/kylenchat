// The small square in the bottom right corner of the chat and the alert box.
// Dragging it resizes the window. The window can't resize itself, so we only send
// how far the mouse moved and the main process changes the size.
function setupResizeGrip(grip) {
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const startX = e.screenX;
    const startY = e.screenY;
    api.resizeStart();
    const move = (ev) => api.resizeMove(ev.screenX - startX, ev.screenY - startY);
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      api.resizeEnd();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
}
