const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const P = require("../shared/pilots");
const pilots = [
  P.createCustom("custom-turn-ui", "Turn Pilot"),
  P.createAce(P.catalog.aces.find((a) => a.price && a.initialLevel < 5).id),
];
async function setup(page) {
  await page.addInitScript(
    (pilots) =>
      localStorage.setItem(
        "projectgreed.custom-pilots.v3.shared",
        JSON.stringify({ pilots, awards: [] }),
      ),
    pilots,
  );
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
}

test("contract settlement XP persists once for PMC and ACE", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.locator('#profileCompanyName').fill('Contract pilots');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(pilots => {
    const save = ProfileSave.exportData();
    for (const store of Object.values(save.pilots)) store.pilots = [];
    for (const pilot of pilots) save.pilots[pilot.faction].pilots.push(pilot);
    ProfileSave.importData(save);
  }, pilots);
  await page.reload();await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate((pilots) => {
    const awards = pilots.map((p, i) => ({ id: 'contract-settlement-' + i, pilotId: p.id,
      faction: p.faction, kind: 'contract', points: 0, experiencePoints: 5000, persistent: true }));
    const snapshot = { matchId: 'contract-settlement', phase: 'idle', rewardsSettled: false,
      settings: { mode: 'sweep' }, pilotAwards: awards };
    const read = () => JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared'));
    Formation.receivePilotAwards(snapshot);
    const before = read();
    Formation.receivePilotAwards({ ...snapshot, phase: 'finished', rewardsSettled: true });
    const settled = read();
    Formation.receivePilotAwards({ ...snapshot, phase: 'finished', rewardsSettled: true });
    return { before, settled, repeated: read() };
  }, pilots);
  expect(result.before.pilots.map(p => p.experience)).toEqual([0, 0]);
  expect(result.settled.pilots.map(p => p.experience)).toEqual([5000, 5000]);
  expect(result.repeated).toEqual(result.settled);
  await page.reload();await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v3.shared')).pilots.map(p => p.experience))).toEqual([5000, 5000]);
});
test("all mode XP saves in the combat turn for PMC and ACE and replays no floating receipt twice", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate((pilots) => {
    const original = CombatPlayback.waitingFor;
    let waiting = true;
    CombatPlayback.waitingFor = () => waiting;
    const before = Object.values(Formation.exportPilotStores())
      .flatMap((store) => store.pilots)
      .map((p) => ({ id: p.id, xp: p.experience }));
    let snapshot;
    for (const mode of ["quick", "battlefield", "mission", "sweep"]) {
      snapshot = {
        matchId: "turn-xp-ui",
        phase: "playback",
        rewardsSettled: false,
        settings: { mode },
        pilotAwards: pilots.map((p, i) => ({
          id: `${mode}-${i}`,
          pilotId: p.id,
          unitId: "actor-" + i,
          kind: "kill",
          points: 100,
          experiencePoints: 25,
        })),
      };
      PilotRewards.receive(snapshot);
      Formation.receivePilotAwards(snapshot);
      PilotRewards.receive(snapshot);
      Formation.receivePilotAwards(snapshot);
    }
    const early = Object.values(Formation.exportPilotStores())
      .flatMap((store) => store.pilots)
      .map((p) => ({ id: p.id, xp: p.experience }));
    const texts = [];
    const ctx = {
      save() {},
      restore() {},
      strokeText() {},
      fillText(text) {
        texts.push(text);
      },
    };
    for (let i = 0; i < pilots.length; i++)
      PilotRewards.draw(ctx, { id: "actor-" + i }, 100, 100, performance.now());
    const during = texts.length;
    waiting = false;
    RewardNotifications.sync({ ...snapshot, phase: "idle" });
    for (let i = 0; i < pilots.length; i++)
      PilotRewards.draw(ctx, { id: "actor-" + i }, 100, 100, performance.now());
    const afterPlayback = texts.length;
    PilotRewards.receive({ ...snapshot, rewardsSettled: true, phase: "finished" });
    Formation.receivePilotAwards({ ...snapshot, rewardsSettled: true, phase: "finished" });
    Formation.receivePilotAwards({ ...snapshot, replay: true });
    const final = Object.values(Formation.exportPilotStores())
      .flatMap((store) => store.pilots)
      .map((p) => ({ id: p.id, xp: p.experience }));
    CombatPlayback.waitingFor = original;
    return {
      before,
      early,
      final,
      during,
      afterPlayback,
      persisted: JSON.parse(
        localStorage.getItem("projectgreed.custom-pilots.v3.shared"),
      ).pilots.map((p) => ({ id: p.id, xp: p.experience })),
    };
  }, pilots);
  expect(result.during).toBe(0);
  expect(result.afterPlayback).toBe(8);
  for (const previous of result.before)
    expect(result.early.find((p) => p.id === previous.id).xp).toBe(previous.xp + 100);
  expect(result.final).toEqual(result.early);
  expect(result.persisted).toEqual(result.early);
});
test("loaded campaign pilot XP plays this turn without entering the PMC profile", async ({
  page,
}) => {
  await setup(page);
  const result = await page.evaluate((pilot) => {
    const original = CombatPlayback.waitingFor;
    let waiting = true;
    CombatPlayback.waitingFor = () => waiting;
    const before = Formation.exportPilotStores();
    const snapshot = {
      matchId: "campaign-xp-ui",
      startedFromSave: true,
      campaign: { turn: 2 },
      phase: "playback",
      rewardsSettled: false,
      pilotAwards: [
        {
          id: "campaign-xp",
          pilotId: pilot.id,
          unitId: "campaign-actor",
          kind: "kill",
          points: 100,
          experiencePoints: 80,
          persistent: false,
        },
      ],
    };
    PilotRewards.receive(snapshot);
    Formation.receivePilotAwards(snapshot);
    waiting = false;
    RewardNotifications.sync({ ...snapshot, phase: "idle" });
    const texts = [];
    PilotRewards.draw(
      {
        save() {},
        restore() {},
        strokeText() {},
        fillText(t) {
          texts.push(t);
        },
      },
      { id: "campaign-actor" },
      100,
      100,
      performance.now(),
    );
    const after = Formation.exportPilotStores();
    CombatPlayback.waitingFor = original;
    return { before, after, texts };
  }, pilots[0]);
  expect(result.texts).toHaveLength(1);
  expect(result.texts[0]).toContain("80");
  expect(result.after).toEqual(result.before);
});
