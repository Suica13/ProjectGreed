const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const P = require("../shared/pilots.js"),
  kits = require("../shared/production-data.cjs").defaultKits;
const profiles = P.catalog.aces
  .filter((p) => p.price)
  .map((p) =>
    P.custom({
      ...P.createAce(p.id),
      level: 5,
      experience: 20000,
      stats: undefined,
      record: {
        kills: 12345,
        shipKills: 123,
        battles: 5678,
        losses: 999,
        destroyedCost: 99999,
        lostCost: 999,
      },
    }),
  );
for (const [width, height] of [
  [1920, 1080],
  [1440, 900],
  [1366, 768],
  [390, 844],
  [360, 740],
])
  test(`device-specific card counts fill each panel at ${width}x${height}`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width, height });
    await page.addInitScript(
      ({ profiles, kits }) => {
        localStorage.setItem(
          "projectgreed.custom-pilots.v3.shared",
          JSON.stringify({ pilots: profiles, awards: [] }),
        );
        const ids = ["MedeaKai", "RGM_79", ...Array(10).fill("Type61")];
        const units = ids.map((unitId, i) => ({
          unitId,
          kitId: kits[unitId],
          ...(i === 1 ? { preload: { carrierIndex: 0, hangarId: "Hangar_1" } } : {}),
        }));
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({ version: 3, squads: [{ name: "Density", units }] }),
        );
        localStorage.setItem(
          "projectgreed.economy.v1",
          JSON.stringify({
            schemaVersion: 3,
            money: 10000,
            supplies: 20000,
            licenses: Object.fromEntries(ids.map((id) => [id, true])),
            inventory: Object.fromEntries(ids.map((id) => [id, 20])),
            kits: Object.fromEntries(ids.map((id) => [id + "__" + kits[id], 20])),
          }),
        );
      },
      { profiles, kits },
    );
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    for (const language of ["en", "ja", "zh"])
      for (const [view, id, selector] of [
        ["formation", "formationUnits", ".formation-row"],
        ["pilots", "customPilotList", ".custom-pilot-card"],
        ["production", "productionList", ".production-unit"],
        ["encyclopedia", "encyclopediaList", ".encyclopedia-unit"],
      ]) {
        await page.evaluate(
          ({ language, view }) => {
            I18n.setLanguage(language);
            MenuShell.go(view);
          },
          { language, view },
        );
        await page.evaluate(
          () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
        );
        const geometry = await page.locator("#" + id).evaluate((list, selector) => {
          list.scrollTop = 0;
          const rect = list.getBoundingClientRect();
          const cards = [...list.querySelectorAll(":scope > " + selector)];
          return {
            panel: { top: rect.top, bottom: rect.bottom, height: rect.height },
            visible: cards.filter((c) => {
              const r = c.getBoundingClientRect();
              return (
                r.top >= Math.max(0, rect.top) - 1 &&
                r.bottom <= Math.min(innerHeight, rect.bottom) + 1
              );
            }).length,
            bottomGap: Math.min(innerHeight, rect.bottom) - cards[Math.min(cards.length, innerWidth > 1100 ? (list.id === "productionList" ? 6 : 8) : list.id === "formationUnits" && innerWidth <= 720 ? 6 : 4) - 1].getBoundingClientRect().bottom,
            heights: [...new Set(cards.map((c) => c.getBoundingClientRect().height))],
            actionsRight: cards.every(card => {
              const label = card.querySelector(".formation-unit-name");
              if (!label) return true;
              const actions = card.querySelector(".formation-row-actions");
              const buttons = [...actions.children].map(button => button.getBoundingClientRect());
              return actions.getBoundingClientRect().left >= label.getBoundingClientRect().right - 1 &&
                Math.abs(buttons[0].top - buttons[1].top) <= 1 && buttons[2].top > buttons[0].top;
            }),
            desktopReadable: innerWidth < 1920 || cards.every(card => {
              const image = card.querySelector(".production-unit-portrait img, .pilot-roster-portrait img, .formation-icon");
              const name = card.querySelector(".unit-line-title, .pilot-roster-heading, .formation-unit-name > strong");
              return !image || !name || (image.getBoundingClientRect().height >= 80 && parseFloat(getComputedStyle(name).fontSize) >= 18);
            }),
            topAligned: cards.every(card => {
              const image = card.querySelector(".production-unit-portrait, .pilot-roster-portrait, .formation-unit-portrait");
              const text = card.querySelector(".production-unit-info, .custom-pilot-summary, .formation-unit-name");
              return (innerWidth <= 720 && !!card.querySelector(".formation-unit-name")) || !image || !text || Math.abs(image.getBoundingClientRect().top - text.getBoundingClientRect().top) <= 1;
            }),
            tagRows: cards.every(card => [...card.querySelectorAll(".unit-tags-two-rows")].every(tags => {
              const first = tags.children[0].getBoundingClientRect(), second = tags.children[1].getBoundingClientRect();
              return second.top >= first.bottom && [...tags.children].every(row => row.querySelectorAll("[data-tag]").length <= 5);
            })),
            overflow: cards
              .filter(
                (c) => c.scrollHeight > c.clientHeight + 1 || c.scrollWidth > c.clientWidth + 1,
              )
              .slice(0, 3)
              .map((c) => ({
                name: c.textContent,
                height: c.clientHeight,
                scroll: c.scrollHeight,
              })),
          };
        }, selector);
        expect(
          geometry.visible,
          JSON.stringify({ width, height, language, view, ...geometry }),
        ).toBe(width > 1100 ? (view === "production" ? 6 : 8) : view === "formation" ? 6 : 4);
        expect(geometry.heights).toHaveLength(1);
        expect(geometry.bottomGap).toBeGreaterThanOrEqual(-1);
        expect(geometry.bottomGap).toBeLessThan(12);
        expect(geometry.actionsRight, view + " right-hand controls").toBe(true);
        expect(geometry.desktopReadable, view + " desktop scale").toBe(true);
        expect(geometry.topAligned, view + " portrait alignment").toBe(true);
        expect(geometry.tagRows, view + " tag rows").toBe(true);
        expect(geometry.overflow, view + " " + language).toEqual([]);
        if (language === "en")
          await page.locator("#" + id).screenshot({ path: `tmp/density-${view}-${width}.png` });
        if (view === "pilots")
          expect(await page.locator("#customPilotList .pilot-record-cell").count()).toBe(
            profiles.length * 4,
          );
        if (view === "formation") {
          await expect(page.locator(".formation-group-banner")).toHaveCount(0);
          await expect(page.locator(".formation-boarding-badge")).toHaveCount(0);
          expect(
            await page.locator(".formation-cargo-note").evaluate((note) => {
              const line = note.closest(".formation-stock-line");
              return (
                !!line &&
                Math.abs(line.getBoundingClientRect().right - note.getBoundingClientRect().right) <=
                  1
              );
            }),
          ).toBe(true);
          expect(
            await page.locator("#formationUnits > .formation-row").evaluateAll((rows) =>
              rows.every((row) => {
                const index = Number(row.dataset.formationIndex);
                return row
                  .querySelector(".formation-unit-name > strong")
                  .textContent.startsWith(index + 1 + ". ");
              }),
            ),
          ).toBe(true);
        }
      }
  });
