const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const legacy of [false, true])
  for (const landscape of [false, true])
    test(`Android initial layout and battle buffers stay stable (${legacy ? "legacy viewport units" : "modern"}, ${landscape ? "landscape" : "portrait"})`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        viewport: landscape ? { width: 844, height: 390 } : { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      });
      try {
        const page = await context.newPage(),
          errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        if (legacy)
          await page.addInitScript(() =>
            document.addEventListener("DOMContentLoaded", () => {
              // Simulate a parser that rejects dvh/dvw, including their feature queries.
              for (const style of document.querySelectorAll("style"))
                style.textContent = style.textContent
                  .replace(/dvh\b/g, "unsupportedvh")
                  .replace(/dvw\b/g, "unsupportedvw");
            }),
          );
        await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
        await expect(page.locator("#openSkirmish")).toBeEnabled();
        if (landscape) await expect(page.locator("html")).toHaveClass(/phone-landscape/);
        else await expect(page.locator("html")).not.toHaveClass(/phone-landscape/);
        const menu = await page.locator("#menuShell").boundingBox();
        expect(menu.width).toBe(landscape ? 1600 : 390);
        expect(menu.height).toBeGreaterThan(50);
        await page.evaluate(async () => {
          await SpriteRenderer.load();
          Net.leave();
          TurnFlow.reset();
          const e = { unitId: "Type61", kitId: "standard" };
          game = Rules.create(false, 1, [[e], [e]], false, {
            costLimit: 99999,
            unitCostLimit: 10000,
          });
          selected = pending = battleView = moving = null;
          mode = "select";
          phase = "idle";
          setPageView("game");
          update();
          drawMap(performance.now());
        });
        const geometry = await page.evaluate(() => ({
          height: byId("gameScene").getBoundingClientRect().height,
          width: byId("map").width,
          canvasHeight: byId("map").height,
          scale: visualViewport.scale,
          dpr: devicePixelRatio,
        }));
        expect(geometry.height).toBe(landscape ? 900 : 844);
        expect(geometry.width * geometry.canvasHeight).toBeLessThanOrEqual(4000000);
        expect(geometry.width).toBeLessThan(3000);
        const stability = await page.evaluate(async () => {
          let metaWrites = 0,
            bufferWrites = 0,
            blankFrames = 0;
          const c = byId("map"),
            meta = document.querySelector("meta[name=viewport]");
          const observer = new MutationObserver((records) => (metaWrites += records.length));
          observer.observe(meta, { attributes: true, attributeFilter: ["content"] });
          const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width");
          Object.defineProperty(c, "width", {
            configurable: true,
            get() {
              return descriptor.get.call(this);
            },
            set(v) {
              bufferWrites++;
              descriptor.set.call(this, v);
            },
          });
          const original = visualViewport.width;
          for (let i = 0; i < 40; i++) {
            Object.defineProperty(visualViewport, "width", {
              configurable: true,
              get: () => original + (i % 2 ? 0.01 : -0.01),
            });
            visualViewport.dispatchEvent(new Event("resize"));
            await new Promise(requestAnimationFrame);
            drawMap(performance.now());
            if (!c.getContext("2d").getImageData(0, 0, 1, 1).data[3]) blankFrames++;
          }
          delete visualViewport.width;
          delete c.width;
          observer.disconnect();
          return { metaWrites, bufferWrites, blankFrames };
        });
        expect(stability).toEqual({ metaWrites: 0, bufferWrites: 0, blankFrames: 0 });
        expect(errors).toEqual([]);
      } finally {
        await context.close();
      }
    });
