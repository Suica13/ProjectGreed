const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const Rules = require("../shared/rules.js");
test("share export and legacy import strip pilot records and assignments", () => {
  const source = fs.readFileSync("client/formation.js", "utf8");
  const context = vm.createContext({ Rules, TextEncoder, TextDecoder, btoa, atob });
  vm.runInContext(
    source.slice(
      source.indexOf("  const sharePrefix"),
      source.indexOf("  function uniqueSquadName"),
    ) + "\nglobalThis.api={encodeShare,decodeShare};",
    context,
  );
  const entry = {
    unitId: "Type61",
    kitId: "standard",
    customName: "Tank",
    customPilot: Rules.pilots.createCustom("custom-private-pilot", "Secret", null, "PMC"),
  };
  const encoded = context.api.encodeShare("share", [entry]);
  const payload = JSON.parse(Buffer.from(encoded.slice(5), "base64url").toString());
  assert.deepEqual(payload.units, [{ unitId: "Type61", kitId: "standard" }]);
  payload.units[0].customPilot = entry.customPilot;
  payload.units[0].pilotId = "custom-private-pilot";
  const imported = context.api.decodeShare(
    "PGF1." + Buffer.from(JSON.stringify(payload)).toString("base64url"),
  );
  assert.equal(imported.units[0].customPilot, undefined);
  assert.equal(imported.units[0].pilotId, undefined);
});

function shareAPI() {
  const source = fs.readFileSync("client/formation.js", "utf8");
  const context = vm.createContext({ Rules, TextEncoder, TextDecoder, btoa, atob });
  vm.runInContext(
    source.slice(
      source.indexOf("  const sharePrefix"),
      source.indexOf("  function uniqueSquadName"),
    ) + "\nglobalThis.api={encodeShare,decodeShare};",
    context,
  );
  return context.api;
}
const pack = (payload) => "PGF1." + Buffer.from(JSON.stringify(payload)).toString("base64url");
test("carrier templates preserve kits and all preload indices without exporting pilot data", () => {
  const api = shareAPI(),
    units = require("../shared/economy").starterFormation();
  units[1].customPilot = { id: "foreign-invalid-pilot" };
  const result = api.decodeShare(api.encodeShare("中文舰队 🚀", units, "standard"));
  assert.equal(result.name, "中文舰队 🚀");
  assert.equal(result.formationStyle, "standard");
  assert.equal(
    JSON.stringify(result.units),
    JSON.stringify(require("../shared/economy").starterFormation()),
  );
});
test("old independent codes infer free formation, while modern codes retain their explicit style", () => {
  const api = shareAPI(),
    units = [{ unitId: "Type61", kitId: "standard" }];
  assert.equal(api.decodeShare(pack({ version: 1, name: "old", units })).formationStyle, "free");
  assert.equal(api.decodeShare(api.encodeShare("free", units, "free")).formationStyle, "free");
  const fleet = require("../shared/economy").starterFormation();
  assert.equal(
    api.decodeShare(pack({ version: 1, name: "fleet", units: fleet })).formationStyle,
    "standard",
  );
});
test("line-wrapped codes decode and invalid entries, preload manifests and styles are rejected", () => {
  const api = shareAPI(),
    code = api.encodeShare("fleet", require("../shared/economy").starterFormation());
  const wrapped =
    code.slice(0, 5) +
    code
      .slice(5)
      .match(/.{1,40}/g)
      .join("\n ");
  assert.equal(api.decodeShare(wrapped).name, "fleet");
  for (const units of [
    [null],
    [1],
    [[]],
    [{ unitId: "missing", kitId: "standard" }],
    [],
    Array(73).fill({ unitId: "Type61", kitId: "standard" }),
    [{ unitId: "Type61", kitId: "standard", preload: { carrierIndex: 99, hangarId: "Hangar_1" } }],
  ])
    assert.throws(() => api.decodeShare(pack({ version: 1, name: "bad", units })));
  assert.throws(() =>
    api.decodeShare(
      pack({
        version: 1,
        name: "bad",
        units: require("../shared/economy").starterFormation(),
        formationStyle: "anything",
      }),
    ),
  );
  assert.throws(() => api.encodeShare("empty", []), /空编组/);
  assert.throws(() => api.decodeShare("PGF1.%%%"), /分享代码无效/);
});
