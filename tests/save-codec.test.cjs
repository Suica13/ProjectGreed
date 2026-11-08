"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const vm = require("node:vm"),
  fs = require("node:fs");
const codec = require("../shared/save-codec.js");
const G = require("../shared/rules.js"),
  PilotSystem = require("../shared/pilots.js");
function api() {
  const context = vm.createContext({
    SaveCodec: codec,
    Rules: G,
    PilotSystem,
    structuredClone,
    ProfileStorage: require("../client/profile-storage.js"),
    ProfileMigrations: require("../shared/profile-migrations.js"),
    Economy: require("../shared/economy.js"),
    Development: require("../shared/development.js"),
    ProfileIdentity: {
      key: "projectgreed.profile-identity.v1",
      validate: (value) => value,
      snapshot: () => ({ id: "unchanged", secret: "private" }),
    },
  });
  vm.runInContext(
    fs.readFileSync("client/profile-save-core.js", "utf8") + ";globalThis.api = ProfileSave",
    context,
  );
  return context.api;
}
function fixture() {
  const factions = ["PMC", "EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"];
  const pilot = PilotSystem.createCustom("custom-codec", "Save pilot");
  pilot.uploadedPortrait = "data:image/jpeg;base64,/9j/" + "A".repeat(10000);
  const data = {
    format: "ProjectGreed-profile",
    schemaVersion: 1,
    identity: { id: "unchanged", secret: "private" },
    pilots: Object.fromEntries(
      factions.map((f) => [f, { pilots: f === "PMC" ? [pilot] : [], awards: ["keep-award"] }]),
    ),
    formations: Object.fromEntries(factions.map((f) => [f, null])),
    economy: {
      schemaVersion: 3,
      money: 1234,
      supplies: 5678,
      licenses: { MS_06F: true },
      inventory: { MS_06F: 5 },
      claimed: {},
    },
    development: { points: { EFSF: 500, ZEON: 1000 }, claimed: {} },
  };
  data.formations.PMC = {
    version: 3,
    index: 0,
    squads: Array.from({ length: 30 }, (_, i) => ({
      name: "Squad" + i,
      units: [{ unitId: "MS_06F", kitId: "machine_gun", customPilot: pilot }],
    })),
  };
  for (let i = 0; i < 200; i++)
    data.economy.claimed["match-long-identity-reward-" + i] = "match-long-identity";
  return data;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
test("save v3 removes repeated assigned portraits and round-trips complete progression", () => {
  const save = api(),
    input = save.validate(fixture()),
    packed = save.encodeData(input);
  assert.equal(packed.schemaVersion, 3);
  assert.ok(JSON.stringify(packed).length < JSON.stringify(input).length / 8);
  assert.deepEqual(plain(save.validate(packed)), plain(input));
  assert.equal(packed.formations.PMC.squads[0].units[0].customPilot.id, "custom-codec");
});
test("old v1/v2 saves still validate and missing v3 pilot references reject", () => {
  const save = api(),
    input = fixture(),
    v2 = {
      ...input,
      schemaVersion: 2,
      development: codec.packClaims(input.development),
      economy: codec.packClaims(input.economy),
    };
  assert.deepEqual(plain(save.validate(v2)), plain(save.validate(input)));
  const v3 = plain(save.encodeData(input));
  v3.pilots.PMC.pilots = [];
  assert.throws(() => save.validate(v3), /驾驶员/);
});
test("different archived pilot stats are preserved rather than replaced by a same-ID roster profile", () => {
  const save = api(),
    input = fixture();
  input.formations.PMC.squads[0].units[0].customPilot = {
    ...input.pilots.PMC.pilots[0],
    name: "Archived pilot",
  };
  const normalized = save.validate(input),
    packed = save.encodeData(normalized);
  assert.equal(packed.formations.PMC.squads[0].units[0].customPilot.name, "Archived pilot");
  assert.deepEqual(plain(save.validate(packed)), plain(normalized));
});
test("receipt compression keeps deduplication keys including prototype-looking IDs", () => {
  const claimed = Object.fromEntries([
    ["__proto__", "match"],
    ["constructor", "match"],
    ...Array.from({ length: 80 }, (_, i) => ["receipt-repeated-prefix-" + i, "match"]),
  ]);
  const input = { money: 100, claimed },
    packed = codec.stringify(input),
    decoded = codec.parse(packed);
  assert.ok(packed.length < JSON.stringify(input).length);
  assert.deepEqual(decoded, input);
  assert.equal(Object.getPrototypeOf(decoded.claimed), Object.prototype);
  decoded.claimed.newReceipt = "next";
  assert.equal(decoded.claimed.newReceipt, "next");
  assert.throws(() => codec.unpackClaims({ claimedPacked: [["match", "", ["same", "same"]]] }));
  assert.throws(() => codec.unpackClaims({ claimedPacked: [["match", "", [4]]] }));
});
test("native snapshots read compact receipts and exported entries keep small records conventional", () => {
  const save = api(),
    input = save.validate(fixture()),
    writes = Object.fromEntries(save.storageEntries(input));
  const snapshot = {
    format: "ProjectGreed-app-store",
    version: 1,
    revision: 7,
    values: Object.fromEntries(Object.entries(writes).filter(([, value]) => value !== null)),
  };
  assert.deepEqual(plain(save.fromNativeSnapshot(snapshot)), plain(input));
  assert.equal(codec.stringify({ claimed: {}, money: 10 }), '{"claimed":{},"money":10}');
});
