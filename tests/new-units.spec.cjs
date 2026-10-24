const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { createServer } = require("../server.js"),
  WebSocket = require("ws"),
  { randomUUID } = require("node:crypto");
const newIds = ["MS_06F", "MS_09", "RGM_79_G", "MS_06J", "MS_06K"];
test("new unit art, all native weapons and mixed-shot battle frames render offline with the new catalogue", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openFormation").click();
  for (const id of newIds) {
    await page.locator('[data-unit-id="' + id + '"]').click();
    await page.locator("#addFormationUnit").click();
  }
  await expect(page.locator(".formation-row")).toHaveCount(8);
  await page.locator("#saveFormation").click();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  expect(
    await page.evaluate(() => [
      ...new Set(game.units.filter((u) => u.team === 0).map((u) => UnitModels[u.model].prefabId)),
    ]),
  ).toEqual(["RGM_79", ...newIds]);
  const result = await page.evaluate((ids) => {
    const gallery = document.createElement("canvas");
    gallery.id = "native-gallery";
    gallery.width = 1500;
    gallery.height = 680;
    gallery.style.cssText =
      "position:fixed;left:0;top:0;width:1500px;height:680px;z-index:9999;background:#12242d";
    document.body.append(gallery);
    const ctx = gallery.getContext("2d");
    const keys = [
      "MS_06F__machine_gun",
      "MS_09__bazooka",
      "RGM_79_G__beam_rifle",
      "MS_06J__magella_cannon",
      "MS_06K__big_gun",
    ];
    for (const [index, id] of keys.entries()) {
      const model = UnitModels[id],
        x = index * 300 + 150;
      ctx.fillStyle = "#ecf5f7";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(model.name, x, 35);
      ctx.font = "14px sans-serif";
      ctx.fillText(model.code + " / " + model.kitName, x, 62);
      SpriteRenderer.draw(ctx, id, x, 190, 3, 90, null, 0, model.weapons[0].id, false, true);
      const melee = model.weapons.find((w) => w.type === "melee");
      ctx.fillStyle = "#ecf5f7";
      ctx.fillText(melee.name, x, 370);
      SpriteRenderer.draw(ctx, id, x, 510, 3, 90, melee.clip, 0.6, melee.id, false, true);
    }
    const battle = document.createElement("canvas");
    battle.id = "native-battle";
    battle.style.cssText = "position:fixed;left:0;top:0;width:1000px;height:500px;z-index:9998";
    document.body.append(battle);
    const seen = new Set(),
      outputs = [];
    for (const model of Object.values(UnitModels).filter((m) => ids.includes(m.prefabId))) {
      for (const weapon of model.weapons) {
        const key = model.prefabId + "/" + weapon.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const entry = { unitId: model.prefabId, kitId: model.kitId };
        const g = Rules.create(false, 1500, [
            [entry],
            [{ unitId: "RGM_79", kitId: "machine_gun" }],
          ]),
          [a, b] = g.units;
        Object.assign(a, { x: 2, y: 4, hp: 100000 });
        Object.assign(b, { x: 2 + weapon.min, y: 4, hp: 100000, shield: 0 });
        g.tiles[b.y][b.x] = "plain";
        const event = Rules.fight(g, a, b, weapon, "evade")[0],
          plan = BattleScene.timeline(event, a, b, 1000, 500).plan;
        for (const contact of plan.contacts)
          BattleScene.draw(battle, {
            left: a,
            right: b,
            event,
            ratio: (contact.at + 0.001) / plan.duration,
            elapsed: contact.at,
            time: contact.at,
            completed: false,
            displayHp: { [a.id]: a.hp, [b.id]: event.before },
          });
        const finalHp = WeaponEffects.health(event, plan, plan.duration, event.before);
        outputs.push({
          key,
          strikes: event.strikes.length,
          contacts: plan.contacts.length,
          finalHp,
          after: event.after,
        });
      }
    }
    return outputs;
  }, newIds);
  expect(result).toHaveLength(22);
  for (const row of result) {
    expect(row.contacts, row.key).toBe(row.strikes);
    expect(row.finalHp, row.key).toBe(row.after);
  }
  await page.locator("#native-gallery").screenshot({ path: ".openai/new-unit-gallery.png" });
  expect(errors).toEqual([]);
});
class Peer {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.frames = [];
    this.ws.on("message", (raw) => {
      this.frames.push(JSON.parse(raw));
    });
  }
  async open() {
    await new Promise((r, j) => {
      this.ws.once("open", r);
      this.ws.once("error", j);
    });
  }
  async wait(predicate) {
    await expect.poll(() => this.frames.some(predicate)).toBe(true);
    return this.frames.find(predicate);
  }
  async hello(room, name) {
    this.ws.send(JSON.stringify({ type: "hello", mode: "join", room, name }));
    await this.wait((m) => m.type === "joined");
  }
  async act(room, action, fields = {}) {
    const id = randomUUID();
    this.ws.send(
      JSON.stringify({ type: "action", action, id, revision: room.revision, ...fields }),
    );
    const response = await this.wait((m) => m.ack === id || m.id === id);
    expect(response.type, response.message).not.toBe("error");
    return response;
  }
}
test("red-side player's own ring is green, allies blue, enemies red, and non-active players inspect real owner names by map click", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    peers = [],
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("http://127.0.0.1:" + address.port);
    await page.locator("#playerId").fill("<Alice>");
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    await page.locator("#roomCode").fill("RINGS");
    await page.locator("#createRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await waitForRoomSettings(page);
    await expect
      .poll(() => page.evaluate(() => Net.snapshot?.settings.mapId))
      .toBe("crossroads_2v2");
    await page.locator("#chooseSeat3").click();
    await expect.poll(() => page.evaluate(() => Net.seat)).toBe(3);
    for (const name of ["Enemy One", "Ally", "Enemy Two"]) {
      const peer = new Peer("ws://127.0.0.1:" + address.port + "/ws");
      peers.push(peer);
      await peer.open();
      await peer.hello("RINGS", name);
    }
    const room = app.rooms.get("RINGS");
    for (const peer of peers)
      await peer.act(room, "set_ready", {
        ready: true,
        formation: [{ unitId: "MS_06F", kitId: "machine_gun" }],
      });
    await expect.poll(() => page.evaluate(() => Net.revision)).toBe(room.revision);
    await page.evaluate(() =>
      Net.request("set_ready", { ready: true, formation: [{ unitId: "MS_09", kitId: "bazooka" }] }),
    );
    await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
    for (const peer of peers) await peer.act(room, "confirm_formation");
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    for (const peer of peers) await peer.act(room, "confirm_deployment");
    await page.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    expect(await page.evaluate(() => Net.canAct())).toBe(false);
    await page.evaluate(() => {
      window.recordedRings = {};
      const draw = UnitIdentity.drawRing;
      UnitIdentity.drawRing = (ctx, unit, position, tile) => {
        draw(ctx, unit, position, tile);
        window.recordedRings[unit.id] = ctx.strokeStyle;
      };
    });
    await expect.poll(() => page.evaluate(() => Object.keys(window.recordedRings).length)).toBe(4);
    expect(
      await page.evaluate(() => [recordedRings["3-0"], recordedRings["1-0"], recordedRings["0-0"]]),
    ).toEqual(["#68e99a", "#78ceef", "#fa8b79"]);
    const revision = room.revision;
    for (const [id, name, team] of [
      ["3-0", "<Alice>", "队伍2"],
      ["1-0", "Ally", "队伍2"],
      ["0-0", "Enemy One", "队伍1"],
    ]) {
      const position = await page.evaluate((id) => {
        const u = getUnit(id);
        return {
          x: mapGeo.ox + (u.x + 0.5) * mapGeo.tile,
          y: mapGeo.oy + (u.y + 0.5) * mapGeo.tile,
        };
      }, id);
      await page.locator("#map").click({ position });
      await expect(page.locator("#unitOwner")).toHaveText(name);
      await expect(page.locator("#unitOwnership")).toContainText(team);
    }
    expect(room.revision).toBe(revision);
    await expect(page.locator("#unitOwnership script")).toHaveCount(0);
    await page.screenshot({ path: ".openai/player-ring-ownership.png" });
    expect(errors).toEqual([]);
  } finally {
    for (const p of peers) p.ws.terminate();
    await page.close();
    await app.close();
  }
});
