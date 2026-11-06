const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const P = require("../shared/pilots.js");
const profiles = P.catalog.aces
  .filter((p) => p.price)
  .map((p, i) =>
    P.custom({
      ...P.createAce(p.id),
      level: 5,
      experience: 20000,
      stats: undefined,
      record: {
        kills: 12345,
        shipKills: 123,
        battles: 5678,
        destroyedCost: 123456789,
        lostCost: 98765432,
        losses: 999,
      },
    }),
  );
const base = P.createCustom("custom-language-layout", "PMC Long Pilot Name");
profiles.unshift(
  P.custom({
    ...base,
    level: 8,
    experience: 30000,
    selectedSkillId: P.skillChoices[0].id,
    record: {
      kills: 12345,
      shipKills: 123,
      battles: 5678,
      destroyedCost: 123456789,
      lostCost: 98765432,
      losses: 999,
    },
  }),
);
for (const width of [1440, 1000, 390, 360])
  test(`localized pilot records and skills do not overlap at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    await page.addInitScript(
      (profiles) =>
        localStorage.setItem(
          "projectgreed.custom-pilots.v3.shared",
          JSON.stringify({ pilots: profiles, awards: [] }),
        ),
      profiles,
    );
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
    await page.evaluate(() => MenuShell.go("pilots"));
    for (const language of ["en", "ja", "zh"]) {
      await page.evaluate((language) => I18n.setLanguage(language), language);
      // ResizeObserver and the shared-height update settle after the translation pass.
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))),
          ),
      );
      const geometry = await page
        .locator("#customPilotList > .custom-pilot-card")
        .evaluateAll((cards) => {
          const overlap = (a, b) =>
            Math.min(a.right, b.right) > Math.max(a.left, b.left) + 1 &&
            Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top) + 1;
          return cards.map((card) => {
            const rect = card.getBoundingClientRect(),
              summary = card.querySelector(".custom-pilot-summary");
            const blocks = [...summary.children].map((c) => c.getBoundingClientRect());
            const portrait = card
              .querySelector(".pilot-roster-portrait img")
              .getBoundingClientRect();
            const status = card.querySelector(".pilot-recruit-state");
            const record = card.querySelector(".pilot-record").getBoundingClientRect();
            const style = getComputedStyle(card);
            const statusLayout =
              summary.getBoundingClientRect().left - portrait.right >= 6 &&
              status.previousElementSibling.textContent.startsWith("Lv.") &&
              status.nextElementSibling.classList.contains("pilot-faction-tags") &&
              status.parentElement.classList.contains("pilot-roster-heading") &&
              record.top - card.querySelector(".pilot-list-skills").getBoundingClientRect().bottom <= 2;
            const cells = [...card.querySelectorAll(".pilot-record-cell")];
            return {
              id: card.dataset.pilotId,
              height: rect.height,
              overflow:
                card.scrollWidth > card.clientWidth + 1 ||
                card.scrollHeight > card.clientHeight + 1,
              statusLayout,
              blockOverlap: blocks.some((a, i) => blocks.slice(i + 1).some((b) => overlap(a, b))),
              cellOverlap: cells.some((c, i) =>
                cells
                  .slice(i + 1)
                  .some((other) =>
                    overlap(c.getBoundingClientRect(), other.getBoundingClientRect()),
                  ),
              ),
              recordOverflow: cells.some((c) => c.scrollWidth > c.clientWidth + 1),
              skillsOverflow: [...card.querySelectorAll(".pilot-list-skill")].some(
                (c) => c.scrollWidth > c.clientWidth + 1,
              ),
              outside: blocks.some((b) => b.top < rect.top - 1 || b.bottom > rect.bottom + 1),
            };
          });
        });
      expect(geometry.length).toBeGreaterThan(20);
      expect(new Set(geometry.map((g) => g.height)).size).toBe(1);
      expect(
        geometry.filter(
          (g) =>
            !g.statusLayout || g.overflow ||
            g.blockOverlap ||
            g.cellOverlap ||
            g.recordOverflow ||
            g.skillsOverflow ||
            g.outside,
        ),
        language,
      ).toEqual([]);
      expect(Math.min(...geometry.map((g) => g.height))).toBeGreaterThan(80);
      if (language === "en")
        await page
          .locator("#customPilotList")
          .screenshot({ path: `tmp/pilot-localized-${width}.png` });
    }
  });
