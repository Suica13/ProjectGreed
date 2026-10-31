/* Data-only preview runtime. No profiles, research state, rooms, or audio modules. */
const ART = AssetPool.unpack(window.catalogBootstrap.catalog);
const PRODUCTION_CATALOG = window.catalogBootstrap.production;
const UI_LOCALES = window.catalogBootstrap.locales;
const UnitModels = ART.models;
let pageView = "encyclopedia",
  assetsReady = false;
const byId = (id) => document.getElementById(id);
const element = (tag, className = "", text = "") => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = I18n.text(String(text));
  return node;
};
const formatDistance = (value) => String(Math.round(value));
const Rules = {
  catalog: ART,
  factions: ["EFSF", "ZEON"],
  eras: [
    ...new Set(
      ART.prefabs.flatMap((prefab) => prefab.tags).filter((tag) => /^\d{4}[EL]?$/.test(tag)),
    ),
  ].sort(),
  roundDamage: (value) => WeaponSequence.roundDamage(value),
  actionCost: (weapon) => weapon.actionCost ?? 2,
  typeNames: { beam: "光束", shell: "实弹", melee: "格斗" },
  unitSize: (model) =>
    model.unitTags?.includes("SmallUnit")
      ? "small"
      : model.unitTags?.includes("LargeUnit") || model.stats?.ship || model.ship
        ? "large"
        : "medium",
  unitTagName: (tag) =>
    ({
      MS: "MS",
      MA: "MA",
      MobilePod: "机动吊舱",
      Ship: "舰船",
      Tank: "坦克",
      Vehicle: "车辆",
      Aircraft: "航空器",
      Helicopter: "直升机",
      Infantry: "步兵",
      Amphibious: "两栖",
      Hover: "气垫",
      Support: "补给",
      Recon: "侦察",
      Transport: "搭载",
      SmallUnit: "小型",
      MediumUnit: "中型",
      LargeUnit: "大型",
    })[tag] || tag,
};
const PilotSystem = {
  labels: {
    shooting: "射击",
    melee: "格斗",
    defense: "防御",
    speed: "机动",
    accuracy: "命中",
    reaction: "反应",
    leadership: "指挥",
    awakening: "觉醒",
  },
};
const SpriteEffects = { clipFog() {}, brokenModules() {} };
const unitIcon = (modelId) => ART.assets[ART.units.find((unit) => unit.id === modelId)?.icon] || "";
const note = (message) => GameDialog.alert(message);
function setPageView(view) {
  window.dispatchEvent(new Event("page-changing"));
  pageView = view;
  byId("encyclopediaScreen").hidden = view !== "encyclopedia";
}
const MenuShell = { go: () => Encyclopedia.open() };
