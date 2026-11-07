/* Native package compatibility entry. Bundled for Chromium 80; never loaded by the server. */
import "core-js/actual/structured-clone";
import "core-js/actual/array/at";
import "core-js/actual/string/at";
import "core-js/actual/object/has-own";
import "core-js/actual/string/replace-all";
import "wicg-inert";

const nativeSelectors = CSS.supports("selector(:has(*))") && CSS.supports("selector(:where(*))");
// The DOM operation is synchronous: a purchase must not race a deferred DOM patch.
for (const type of [Element, Document, DocumentFragment]) {
  if (!type.prototype.replaceChildren)
    Object.defineProperty(type.prototype, "replaceChildren", {
      configurable: true,
      writable: true,
      value: function (...children) {
        const fragment = document.createDocumentFragment();
        fragment.append(...children);
        while (this.firstChild) this.removeChild(this.firstChild);
        this.appendChild(fragment);
      },
    });
}
window.AppCompat = Object.freeze({
  target: "chrome80",
  legacyLayout: !nativeSelectors,
  selectors: true,
});
if (!nativeSelectors)
  document.addEventListener("DOMContentLoaded", () => {
    document.documentElement.classList.add("app-legacy-layout");
    // Chromium 80-82 advertises grid on <button>, but lays its children out as blocks.
    // Keep the native button and its events/keyboard semantics; use a normal inner grid.
    const sample = document.createElement("button");
    sample.style.cssText =
      "position:absolute;visibility:hidden;display:grid;grid-template-columns:10px 10px;padding:0;border:0";
    sample.innerHTML = "<span style='display:block'>a</span><span style='display:block'>b</span>";
    document.body.append(sample);
    const buttonGrid =
      sample.children[1].getBoundingClientRect().left -
        sample.children[0].getBoundingClientRect().left >=
      9;
    sample.remove();
    if (!buttonGrid) {
      let queued = false;
      const patch = () => {
        queued = false;
        for (const button of document.querySelectorAll(
          "button.production-unit,button.catalog-unit,button.roster-unit",
        )) {
          if (button.firstElementChild?.classList.contains("legacy-button-inner")) continue;
          const display = button.dataset.legacyLayoutDisplay || getComputedStyle(button).display;
          if (!/grid|flex/.test(display)) continue;
          button.dataset.legacyLayoutDisplay = display;
          const inner = document.createElement("span");
          inner.className = "legacy-button-inner";
          inner.style.cssText = `display:${display};grid-template-columns:inherit;grid-template-rows:inherit;gap:inherit;align-items:inherit;align-content:inherit;justify-content:inherit;flex-direction:inherit;flex-wrap:inherit;width:100%;height:100%;min-width:0;box-sizing:border-box;text-align:inherit`;
          while (button.firstChild) inner.appendChild(button.firstChild);
          button.append(inner);
          button.style.setProperty("display", "block", "important");
        }
      };
      new MutationObserver(() => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(patch);
        }
      }).observe(document.body, { childList: true, subtree: true });
      patch();
    }
    import("css-has-pseudo/browser").then(({ default: cssHasPseudo }) => {
      cssHasPseudo(document, {
        observedAttributes: ["data-page", "data-room-tab", "data-hud-tab"],
        hover: false,
      });
    });
  });
