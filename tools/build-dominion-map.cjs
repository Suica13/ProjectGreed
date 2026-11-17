const fs = require("fs"),
  M = require("../shared/map-document"),
  B = require("./rebuild-biome-maps.cjs");
const doc = M.create({
  id: "dominion_highlands",
  name: "[占山为王][2v2]高地争夺",
  description: "每名玩家拥有独立基地，通过生产、研究和争夺据点发展部队。",
  width: 66,
  height: 50,
  playersPerTeam: 2,
  environment: "ground",
  supportedModes: ["dominion"],
});
doc.spawns = [
  { team: 0, position: 1, x: 10, y: 11, heading: 90 },
  { team: 1, position: 1, x: 55, y: 11, heading: 270 },
  { team: 0, position: 2, x: 10, y: 37, heading: 90 },
  { team: 1, position: 2, x: 55, y: 37, heading: 270 },
];
doc.deploymentAreas = doc.spawns.map((s) => ({ x: s.x - 6, y: s.y - 6, width: 13, height: 13 }));
const map = M.compile(doc);
for (let y = 0; y < 50; y++)
  for (let x = 0; x < 66; x++)
    map.tiles[y][x] =
      x > 25 && x < 40 && (y < 6 || y > 44)
        ? "forest"
        : x > 27 && x < 38 && y > 20 && y < 29
          ? "highland"
          : "plain";
const rebuilt = B.rebuild(map);
rebuilt.dominion = {
  points: [
    { id: "north", name: "北部小型据点", x: 32, y: 10, size: 1 },
    { id: "central", name: "中央大型据点", x: 32, y: 25, size: 3 },
    { id: "south", name: "南部中型据点", x: 32, y: 40, size: 2 },
  ],
};
const frontline = JSON.parse(fs.readFileSync("assets/maps/battlefield/frontline.json", "utf8"));
rebuilt.dominion.pointIcon = frontline.battlefield.pointIcon;
rebuilt.tileMap.dominion = rebuilt.dominion;
fs.mkdirSync("assets/maps/dominion", { recursive: true });
fs.writeFileSync("assets/maps/dominion/highlands.json", JSON.stringify(rebuilt, null, 2) + "\n");
const file = "assets/unit-catalog.json",
  c = JSON.parse(fs.readFileSync(file));
if (!c.maps.includes("maps/dominion/highlands.json")) c.maps.push("maps/dominion/highlands.json");
fs.writeFileSync(file, JSON.stringify(c, null, 2) + "\n");
console.log("Built compact 2v2 dominion map");
