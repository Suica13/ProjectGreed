/* Copy UI icons only. The source MOD is never modified. */
const fs = require("node:fs"), path = require("node:path");
const root = path.resolve(__dirname, ".."),
  source = process.argv[2] || "E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5/Resource/Image/Units/Button/Weapon";
const classes = {
  rifle: "LinearRifle_1", beam_rifle: "BeamRifle_1", beam_spray: "BeamGun_1",
  beam_gun: "BeamGun_1", beam_cannon: "BeamCannon_1", beam_smart_gun: "BeamSniperRifle_1",
  shell_shotgun: "ShellShotGun_1", beam_shotgun: "BeamShotGun_1", beam_bazooka: "Bazooka_2",
  beam: "BeamMachineGun_1", close_defense: "Ciws_1", small_vulcan: "Ciws_1",
  machine_gun: "MachineGun_1", bazooka: "Bazooka_1", panzerfaust: "Panzerfaust_1",
  cannon: "ShellCannon_1", irradiation: "BeamCannon_2", melee: "Cqb_1",
  missile: "Missile_1", grenade: "Grenade_2", grenade_launcher: "Grenade_1",
  sniper: "ShellSniperRifle_1", mortar: "Mortar_1", remote: "Funnel_1",
  flamethrower: "FlameThrower_1", bomb: "Missile_2", nuke: "Missile_3",
  ram: "Cqb_5", other: "AimShoot_1",
};
const variants = { wrist: "ArmGun_2", railgun: "Railgun_1", incom: "Incom_1", shell_scatter_bazooka: "ShellShotGun_2" };
const target = path.join(root, "assets/ui/weapon-icons");
for (const name of Object.values({ ...classes, ...variants }))
  if (!fs.existsSync(path.join(source, name + ".png"))) throw Error("Missing icon: " + name);
fs.mkdirSync(target, { recursive: true });
for (const name of new Set(Object.values({ ...classes, ...variants })))
  fs.copyFileSync(path.join(source, name + ".png"), path.join(target, name + ".png"));
fs.writeFileSync(path.join(root, "assets/ui/weapon-icons.json"), JSON.stringify({
  schemaVersion: 1, sourceMod: "GundamWars_BattleOperation2_V5",
  sourceDirectory: "Resource/Image/Units/Button/Weapon",
  variants: Object.fromEntries(Object.entries(variants).map(([id, name]) => [id, "ui/weapon-icons/" + name + ".png"])),
  classes: Object.fromEntries(Object.entries(classes).map(([id, name]) => [id, "ui/weapon-icons/" + name + ".png"])),
}, null, 2) + "\n");
console.log("Imported weapon icons:", Object.keys(classes).length);
