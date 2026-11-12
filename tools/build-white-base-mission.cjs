/* Reproducible cooperative mission, using the modular space biome. */
const fs = require("node:fs"),
  path = require("node:path");
const root = path.resolve(__dirname, ".."),
  M = require("../shared/map-document"),
  B = require("./rebuild-biome-maps.cjs");
const doc = M.create({
  id: "mission_white_base",
  name: "三分钟十二台大魔",
  width: 41,
  height: 25,
  description: "多人合作：歼灭敌军并保护白色基地。十回合内击破六台力克大魔可触发额外增援。",
  environment: "space",
  supportedModes: ["mission"],
  playersPerTeam: 5,
});
const playerSpawns = [
  [7, 5],
  [10, 5],
  [7, 19],
  [10, 19],
  [13, 19],
];
doc.spawns = Array.from({ length: 10 }, (_, i) => ({
  team: i % 2,
  position: Math.floor(i / 2) + 1,
  x: i % 2 ? 30 : playerSpawns[Math.floor(i / 2)][0],
  y: i % 2 ? 5 + Math.floor(i / 2) * 3 : playerSpawns[Math.floor(i / 2)][1],
}));
doc.deploymentAreas = doc.spawns.map((s, i) =>
  s.team
    ? { x: 25, y: 3, width: 13, height: 20 }
    : { x: 3, y: Math.floor(i / 2) < 2 ? 2 : 16, width: 14, height: 8 },
);
for (const t of doc.tiles) t.environment = "space";
const BRT = "Pilot_EFSF_0079_N_ACE_BRT",
  AMR = "Pilot_EFSF_0079_N_ACE_AMR",
  CHA = "Pilot_ZEON_0079_N_ACE_CHA";
const actor = (
  id,
  unitId,
  kitId,
  team,
  x,
  y,
  group,
  initial = true,
  pilotId = null,
  level = 0,
) => ({ id, unitId, kitId, team, x, y, group, initial, ...(pilotId ? { pilotId, level } : {}) });
const line = (who, name, text, pilot) => ({
  actor: who,
  name,
  text,
  portrait: "assets/pilots/" + pilot + ".png",
});
doc.mission = {
  version: 1,
  era: "0079T2",
  technologyLimit: 10000,
  costLimit: 1200,
  unitLimit: 12,
  enemyResourcePerPlayer: 0.25,
  rewards: {
    money: 2000,
    supplies: 3000,
    inventory: { RX_77_2: 2 },
    bonuses: [{ event: "red-comet", money: 2000, supplies: 3000, inventory: { RX_78_2: 1 } }],
  },
  victory: { type: "all_enemies" },
  protect: ["whitebase"],
  actors: [
    {
      ...actor("whitebase", "WhiteBase", "standard", 0, 13, 11, "guests", true, BRT, 0),
      angle: 90,
    },
    ...Array.from({ length: 12 }, (_, i) => ({
      ...actor(
        "dom-" + (i + 1),
        "MS_09R",
        "bazooka",
        1,
        26 + (Math.floor(i / 3) % 2) * 4,
        7 + Math.floor(i / 6) * 10,
        "dom",
      ),
      angle: 270,
      squad: "dom-" + (Math.floor(i / 3) + 1),
    })),
    ...[5, 12, 20].map((y, i) => ({
      ...actor("chivvay-" + (i + 1), "ChivvayClass", "standard", 1, 35, y, "ships"),
      angle: 270,
    })),
    actor("char", "MS_14S_CharCustom", "kit_0", 1, 39, 12, "reinforcements", false, CHA, 3),
    actor("amuro", "RX_78_2", "kit_0", 0, 1, 12, "guests", false, AMR, 3),
  ],
  events: [
    {
      id: "opening",
      name: "作战开始",
      when: { type: "start" },
      actions: [
        {
          type: "dialogue",
          lines: [
            line("whitebase", "布莱德", "赶在敌方开火之前开始迎击", BRT),
            line("whitebase", "布莱德", "放出MS部队，作战开始", BRT),
          ],
        },
      ],
    },
    {
      id: "red-comet",
      name: "红色彗星与白色流星",
      when: { type: "defeated_group", group: "dom", count: 6, byRound: 10 },
      actions: [
        { type: "spawn", actors: ["char", "amuro"] },
        { type: "protect", actors: ["amuro"] },
        {
          type: "dialogue",
          lines: [
            line("amuro", "阿姆罗", "红色的MS，是夏亚吗？", AMR),
            line("char", "夏亚", "白色的家伙，越来越能干了啊。", CHA),
            line("amuro", "阿姆罗", "得赶紧支援布莱德才行。", AMR),
          ],
        },
      ],
    },
  ],
};
const map = M.compile(doc);
for (let y = 0; y < map.height; y++)
  for (let x = 0; x < map.width; x++)
    map.tiles[y][x] = (y < 3 || y > 22) && (x * 17 + y * 11) % 7 < 2 ? "rock" : "plain";
const result = B.rebuild(map);
result.mission = doc.mission;
result.tileMap.mission = doc.mission;
const file = path.join(root, "assets/maps/missions/white_base.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(result, null, 2) + "\n");
const catalogPath = path.join(root, "assets/unit-catalog.json"),
  catalog = JSON.parse(fs.readFileSync(catalogPath));
if (!catalog.maps.includes("maps/missions/white_base.json")) {
  catalog.maps.push("maps/missions/white_base.json");
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + "\n");
}
console.log(file);
