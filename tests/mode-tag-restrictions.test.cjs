const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const { createRoomEngine } = require("../shared/room-engine");

const bans = { bannedFactions: ["EFSF"], bannedEras: ["UC_0079_T1"], bannedTypes: ["MS"] };
for (const mode of ["sweep", "mission", "battlefield"]) {
  test(`${mode} ignores stale room and team tag bans in shared formation rules`, () => {
    const settings = { ...G.defaultRoomSettings(), mode, ...bans, teamRestrictions: [bans, bans] };
    assert.equal(G.tagRestrictionsEnabled(settings), false);
    for (const seat of [null, 0, 1]) {
      const restrictions = G.formationRestrictions(settings, seat);
      for (const key of Object.keys(bans)) assert.deepEqual(restrictions[key], []);
    }
  });

  test(`${mode} clears attempted tag bans on the authoritative room settings`, t => {
    let serial = 0;
    const engine = createRoomEngine({ rules: G, randomId: () => "tags-" + ++serial,
      randomToken: () => "token-" + ++serial, randomSeed: () => 123, send() {} });
    t.after(() => engine.close());
    const host = {readyState:1};
    engine.join(host,{mode:"create",room:"TAG_RULES",roomMode:mode,characterFaction:"PMC"});
    const room = engine.rooms.get("TAG_RULES");
    engine.action(host,{id:"ban-attempt",revision:room.revision,action:"configure_room",
      ...room.settings,...bans,teamRestrictions:[bans,bans]});
    for (const restrictions of [room.settings,...room.settings.teamRestrictions])
      for (const key of Object.keys(bans)) assert.deepEqual(restrictions[key],[]);
  });
}

test("quick battles retain room and per-team tag bans", () => {
  const settings = {...G.defaultRoomSettings(),mode:"quick",...bans,teamRestrictions:[bans,bans]};
  assert.equal(G.tagRestrictionsEnabled(settings),true);
  const restrictions=G.formationRestrictions(settings,0);
  for(const key of Object.keys(bans)) assert.deepEqual(restrictions[key],bans[key]);
});
