/* Keep layout-viewport changes stable on Android browsers, including older WebViews. */
(() => {
  const root = document.documentElement;
  const viewport = document.querySelector('meta[name="viewport"]');
  const original = viewport.content;
  const mobile =
    matchMedia("(pointer: coarse)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  // Native viewport zoom already scales CSS pixels. Rendering at full desktop DPR
  // in the 1600x900 virtual layout wastes GPU memory on a small Android display.
  window.GameViewport = {
    pixelRatio(width, height) {
      const native = window.devicePixelRatio || 1;
      if (!mobile) return native;
      const scale = window.visualViewport?.scale || 1;
      return Math.min(
        native * Math.min(1, scale),
        2,
        4096 / Math.max(1, width, height),
        Math.sqrt(4000000 / Math.max(1, width * height)),
      );
    },
  };
  if (!mobile) return;
  let frame = 0,
    lastSize = null;
  function refresh() {
    frame = 0;
    const view = window.visualViewport;
    const scale = view?.scale || 1;
    const width = Math.round(view?.width > 0 ? view.width * scale : window.innerWidth);
    const height = Math.round(view?.height > 0 ? view.height * scale : window.innerHeight);
    if (!(width > 0 && height > 0)) return;
    // Ignore keyboard-only resizes so editing fields does not change the viewport.
    if (
      /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) &&
      lastSize &&
      Math.abs(width - lastSize.width) < 2
    )
      return;
    // Meta updates themselves emit visualViewport.resize. Subpixel rounding noise
    // must not feed another scale change and reset the battle canvas every frame.
    if (lastSize && Math.abs(width - lastSize.width) < 2 && Math.abs(height - lastSize.height) < 2)
      return;
    lastSize = { width, height };
    const active = width > height && Math.min(width, height) <= 600;
    if (!active) {
      if (root.classList.contains("phone-landscape")) {
        root.classList.remove("phone-landscape");
        delete root.dataset.phoneWidth;
        viewport.content = original;
      }
      return;
    }
    const zoom = Math.min(width / 1600, height / 900);
    const virtualWidth = Math.round(width / zoom);
    const content = `width=${virtualWidth},initial-scale=${zoom},minimum-scale=${zoom},maximum-scale=${zoom}`;
    root.classList.add("phone-landscape");
    root.dataset.phoneWidth = width;
    if (viewport.content !== content) viewport.content = content;
  }
  function schedule() {
    if (!frame) frame = requestAnimationFrame(refresh);
  }
  // Some Android browsers report the pre-meta viewport while parsing <head>.
  // Re-read after layout/assets/pageshow even if they never dispatch resize.
  function settle() {
    schedule();
    setTimeout(schedule, 100);
    setTimeout(schedule, 300);
  }
  refresh();
  document.addEventListener("DOMContentLoaded", settle);
  addEventListener("load", settle);
  addEventListener("pageshow", settle);
  addEventListener("game-assets-ready", settle);
  addEventListener("resize", schedule);
  addEventListener("orientationchange", settle);
  window.visualViewport?.addEventListener("resize", schedule);
})();
