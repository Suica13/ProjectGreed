const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
}
for (const width of [1440, 390, 360])
  test(
    "pilot filters, colored COST, available training and maximum XP at " + width,
    async ({ page }) => {
      await page.setViewportSize({ width, height: 960 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await open(page);
      await page.evaluate(() => {
        const save = ProfileSave.exportData();
        for (const faction of Object.keys(save.pilots))
          save.pilots[faction] = { pilots: [], awards: [] };
        const fresh = PilotSystem.createCustom("custom-filter-fresh", "Fresh");
        const max = PilotSystem.custom({
          ...fresh,
          id: "custom-filter-max",
          name: "Max",
          level: 8,
          experience: 30000,
          selectedSkillId: PilotSystem.skillChoices[0].id,
          record: { kills: 31, shipKills: 1, battles: 27, destroyedCost: 11650, lostCost: 1525, losses: 4 },
        });
        const spent = PilotSystem.custom({
          ...fresh,
          id: "custom-filter-spent",
          name: "Spent",
          stats: { ...fresh.stats, shooting: 125, melee: 125, defense: 125, awakening: 65 },
        });
        const legacy = {
          ...fresh,
          id: "custom-filter-legacy",
          name: "Legacy",
          trainingVersion: 6,
          level: 10,
          experience: 45000,
        };
        save.pilots.PMC.pilots = [fresh, max, spent, legacy];
        for (const faction of ["EFSF", "ZEON"]) {
          const source = PilotSystem.catalog.aces.find(
            (p) => p.faction === faction && p.price && !p.availableFactions && (faction !== "EFSF" || p.skills.length === 3),
          );
          const pilot = PilotSystem.createAce(source.id);
          save.pilots[faction].pilots.push(
            faction === "EFSF"
              ? PilotSystem.custom({ ...pilot, level: 5, experience: 20000, stats: undefined })
              : PilotSystem.custom({ ...pilot, needsRecruitment: true }),
          );
        }
        const source = PilotSystem.catalog.aces.find((p) => p.availableFactions?.length > 1);
        save.pilots[source.faction].pilots.push(PilotSystem.createAce(source.id));
        ProfileSave.importData(save);
      });
      await page.reload();
      await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
      await page.evaluate(() => {
        I18n.setLanguage("zh");
        MenuShell.go("pilots");
      });
      const list = page.locator("#customPilotList"),
        filter = page.locator("#pilotRosterFilter");
      await expect(list.locator(".custom-pilot-card")).toHaveCount(7);
      await expect(filter.locator("option")).toHaveCount(7);
      await expect(
        list.locator('[data-pilot-id="custom-filter-fresh"] .pilot-training-points'),
      ).toHaveText("强化点+");
      await expect(
        list.locator('[data-pilot-id="custom-filter-spent"] .pilot-training-points'),
      ).toHaveCount(0);
      await expect(
        list.locator('[data-pilot-id="custom-filter-max"] .pilot-roster-progress'),
      ).toContainText("30000/MAX");
      await expect(list.locator('[data-pilot-id="custom-filter-legacy"]')).toContainText("Lv.8");
      await expect(list.locator(".pilot-cost-tag")).toHaveCount(7);
      await expect(list.locator('.pilot-roster-portrait > .pilot-recruit-state')).toHaveCount(7);
      await expect(list.locator('.pilot-roster-portrait > .pilot-recruit-state').first()).toHaveText('已招募');
      await expect(list.locator('.custom-pilot-summary .ace-recruit-status')).toHaveCount(0);
      expect(await list.locator('.pilot-recruit-state').allTextContents()).toContain('待回归');
      expect(await list.locator('.custom-pilot-card').evaluateAll(cards=>cards.every(card=>card.scrollHeight<=card.clientHeight+1))).toBe(true);
      await expect(filter.locator('[value="custom"]')).toHaveText('PMC驾驶员');
      await expect(list.locator(".pilot-list-skills > .pilot-cost-tag:first-child")).toHaveCount(7);
      await expect(list.locator('.pilot-roster-heading [data-faction="PMC"]')).toHaveCount(4);
      await expect(list.locator('.pilot-roster-heading [data-faction="PMC"]').first()).toHaveCSS("color", "rgb(255, 255, 255)");
      await expect(list.locator(".pilot-roster-heading .pilot-cost-tag")).toHaveCount(0);
      expect(await list.locator(".pilot-roster-heading").evaluateAll(headings => headings.every(h => h.children[1].textContent.startsWith("Lv.") && h.children[2].classList.contains("pilot-faction-tags") && h.children[0].getBoundingClientRect().width > 0))).toBe(true);
      await expect(list.locator(".pilot-roster-heading .era-tag")).toHaveCount(3);
      expect(await list.locator(".pilot-roster-heading .ace-name").evaluateAll(names => names.every(name => name.getBoundingClientRect().width >= 36))).toBe(true);
      for (const [value, count] of [
        ["custom", 4],
        ["EFSF", 2],
        ["ZEON", 2],
        ["AEUG", 0],
        ["all", 7],
      ]) {
        await filter.selectOption(value);
        await expect(list.locator(".custom-pilot-card")).toHaveCount(count);
      }
      const heights = await list.locator(".custom-pilot-card").evaluateAll(cards => cards.map(c => c.getBoundingClientRect().height));
      expect(new Set(heights).size).toBe(1);
      if (width >= 1280) {
        const positions=await list.locator(".custom-pilot-card").evaluateAll(cards=>cards.map(card=>({x:card.getBoundingClientRect().x,y:card.getBoundingClientRect().y})));
        expect(positions[0].y).toBe(positions[1].y);
        expect(positions[1].x).toBeGreaterThan(positions[0].x);
      }
      expect(Math.max(...heights)).toBeLessThanOrEqual(width > 1100 ? 120 : 104);
      expect(await list.locator(".pilot-list-skills").evaluateAll(rows => rows.every(row => [...row.children].every(child => child.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom + 1)))).toBe(true);
      expect(await list.locator(".pilot-record").evaluateAll(rows => rows.every(row => [...row.querySelectorAll(".pilot-record-cell")].every(child => child.getBoundingClientRect().bottom <= row.getBoundingClientRect().bottom + 1)))).toBe(true);
      const maxCard = list.locator('[data-pilot-id="custom-filter-max"]');
      await expect(maxCard.locator(".pilot-list-skill img")).toHaveCount(1);
      await expect(maxCard.locator(".pilot-list-skill")).not.toHaveText("");
      expect(await list.locator(".pilot-list-skills img").evaluateAll(images => images.every(img => img.complete && img.naturalWidth > 0))).toBe(true);
      await maxCard.locator(".formation-detail-button").click();
      await expect(page.locator("#customPilotSkills .pilot-list-skill")).toHaveCount(1);
      await page.locator("#finishCustomPilot").click();
      await page.screenshot({ path: ".openai/pilot-roster-" + width + ".png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.locator("#recruitAcePilot").click();
      const recruits = page.locator("#aceRecruitList > .ace-recruit-candidate");
      expect(await recruits.evaluateAll(cards => new Set(cards.map(c => c.getBoundingClientRect().height)).size)).toBe(1);
      expect(await recruits.evaluateAll(cards => cards.every(c => c.querySelectorAll(".pilot-list-skill").length > 0))).toBe(true);
      await page.locator("#aceRecruitDialog").getByRole("button", {name:"关闭",exact:true}).click();
      expect(errors).toEqual([]);
    },
  );
for (const mode of ["regular", "quick"])
  test(
    "room driver controls and faction tags are visible and synchronized in " + mode,
    async ({ page }) => {
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await open(page);
      await page.locator("#openSkirmish").click();
      await page.locator("#offlineRoomMode").selectOption(mode);
      await page.locator("#createOfflineRoom").click();
      await page.waitForFunction(() => Net.snapshot?.members.some((p) => p.bot) && !Net.awaiting);
      for (const value of ["no_custom", "no_ace", "none", "allow"]) {
        await page.locator("#roomPilotPolicy").selectOption(value);
        await expect.poll(() => page.evaluate(() => Net.snapshot.settings.pilotPolicy)).toBe(value);
        await page.waitForFunction(() => !Net.awaiting);
      }
      const details = page.locator("details").filter({ has: page.locator("#roomTagRestrictions") });
      await details.locator("summary").click();
      const faction = page.locator("#roomBan-bannedFactions");
      await expect(faction).toContainText("驾驶员 · PMC");
      await expect(faction).toContainText("驾驶员 · EFSF");
      await faction.selectOption("pilot:EFSF");
      await expect
        .poll(() =>
          page.evaluate(() => Net.snapshot.settings.bannedFactions.includes("pilot:EFSF")),
        )
        .toBe(true);
      expect(errors).toEqual([]);
    },
  );
