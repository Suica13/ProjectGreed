const test = require("node:test"),
  assert = require("node:assert/strict");
const R = require("../shared/match-records.js");

test("write-once recorder baselines match public reconstruction and isolate live game mutations", () => {
  const tiles = [["plain", "plain"]];
  const source = {
    game: {
      round: 1,
      team: 0,
      tiles,
      units: [
        { id: "a", hp: 100, pilot: { name: "Pilot" } },
        { id: "b", hp: 80 },
      ],
    },
    phase: "idle",
    log: ["first"],
    chat: [],
    viewTeam: 0,
  };
  const first = R.capture(null, source, tiles),
    frozen = R.clone(first.baseline);
  source.game.units[0].hp = 50;
  source.game.units[0].pilot.name = "Changed";
  source.game.units.pop();
  source.game.units.push({ id: "new", hp: 40 });
  source.game.round++;
  source.log.unshift("second");
  source.chat.push({ text: "hello" });
  const second = R.capture(first.baseline, source, tiles);
  assert.deepEqual(first.baseline, frozen);
  assert.deepEqual(second.change, R.pack(frozen, source));
  assert.deepEqual(second.baseline, R.unpack(frozen, second.change, tiles));
  const reconstructed = R.unpack(frozen, second.change, tiles);
  reconstructed.game.units[0].pilot.name = "Replay UI";
  assert.equal(second.baseline.game.units[0].pilot.name, "Changed");
  assert.equal(second.change.units[0].pilot.name, "Changed");
  source.game.units[0].pilot.name = "Another live mutation";
  assert.equal(second.baseline.game.units[0].pilot.name, "Changed");
});
