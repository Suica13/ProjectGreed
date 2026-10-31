/* Native viewport scaling keeps desktop breakpoints and pointer coordinates consistent. */
(() => {
  const root = document.documentElement;
  const viewport = document.querySelector('meta[name="viewport"]');
  const original = viewport.content;
  const touchDevice = navigator.maxTouchPoints > 0 && matchMedia("(pointer: coarse)").matches;
  if (!touchDevice) return;
  let frame = 0,
    lastWidth = null;
  function refresh() {
    frame = 0;
    const view = window.visualViewport;
    const width = view ? view.width * view.scale : window.innerWidth;
    const height = view ? view.height * view.scale : window.innerHeight;
    // Ignore keyboard-only resizes so editing fields does not change the viewport.
    if (
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) &&
      lastWidth !== null &&
      Math.abs(width - lastWidth) < 2
    )
      return;
    lastWidth = width;
    const active = width > height && Math.min(width, height) <= 600;
    if (!active) {
      if (root.classList.contains("phone-landscape")) {
        root.classList.remove("phone-landscape");
        delete root.dataset.phoneWidth;
        viewport.content = original;
      }
      return;
    }
    const scale = Math.min(width / 1600, height / 900);
    const virtualWidth = Math.round(width / scale);
    const content = `width=${virtualWidth},initial-scale=${scale},minimum-scale=${scale},maximum-scale=${scale}`;
    root.classList.add("phone-landscape");
    root.dataset.phoneWidth = width;
    if (viewport.content !== content) viewport.content = content;
  }
  function schedule() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(refresh);
  }
  refresh();
  addEventListener("resize", schedule);
  addEventListener("orientationchange", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
})();
