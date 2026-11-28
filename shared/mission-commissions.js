/* Objectives and entry gates for liaison-owned mission stages. No battle rewards. */
const MissionCommissions = (() => {
  const Classes = typeof WeaponClasses !== "undefined" ? WeaponClasses : require("./weapon-classes.js");
  const visible = map => !!map?.mission?.contactTask;
  const unlocked = (map, entries) => visible(map) && (entries || []).some(e =>
    e.id === map.mission.contactTask && ["accepted", "ready", "claimed"].includes(e.status));
  function requireEntry(map, entries) {
    if (!visible(map)) throw Error("该任务关卡暂未开放");
    if (!unlocked(map, entries)) throw Error("请先接取对应的联络人任务，解锁此关卡");
  }
  function initialize(room, G) {
    const map = G.getMap(room.settings.mapId);
    if (!map.mission.contactTask) return;
    room.game.mission.commission = {kills: [], visited: [], failed: false,
      participants: room.seats.filter(p => p && !p.bot && p.seat % 2 === 0 &&
        (p.contactTasks || []).some(e => e.id === map.mission.contactTask && e.status === "accepted")).map(p => p.id)};
  }
  function recordDefeat(room, G, from, to, model, weapon) {
    const state = room.game.mission?.commission;
    if (!state || !from || from.team !== 0 || to.team !== 1 || state.kills.some(k => k.id === to.id)) return;
    const owner = room.seats[G.ownerOf(from)];
    if (!owner || owner.bot) return;
    const attacker = G.modelOf(from), spec = G.getMap(room.settings.mapId).mission.commission;
    const valid = (!spec.attackerUnits || spec.attackerUnits.includes(attacker.prefabId)) &&
      (!spec.attackerKit || attacker.kitId === spec.attackerKit) &&
      (!spec.attackerFaction || (attacker.availableFactions || [attacker.faction]).includes(spec.attackerFaction)) &&
      (!spec.artillery || ["mortar", "cannon", "beam_cannon"].includes(Classes.classify(weapon || {})));
    state.kills.push({id: to.id, actor: to.missionActor, ms: !!model.unitTags?.includes("MS"), valid});
    if ((spec.kind === "kills" || spec.requiredAttackTargets) && !valid && to.missionGroup === "targets") state.failed = true;
  }
  function observe(room, G) {
    const state = room.game.mission?.commission;
    if (!state) return;
    const spec = G.getMap(room.settings.mapId).mission.commission;
    for (const key of spec.forbidDamage || []) {
      const u = room.game.units.find(u => u.missionActor === key);
      if (u && (u.hp < G.modelOf(u).hp || u.shield < G.modelOf(u).shield.hp || Object.values(u.brokenParts || {}).some(Boolean))) state.failed = true;
    }
  }
  const inside = (u, r) => u.x >= r.x && u.y >= r.y && u.x < r.x+r.width && u.y < r.y+r.height;
  function progress(room, G, update = false) {
    const g = room.game, s = g.mission?.commission, m = G.getMap(room.settings.mapId).mission, c = m.commission;
    if (!s || !c) return null;
    const units = g.units.filter(u => u.team === 0 && u.hp > 0 && G.onMap(u) && !u.missionAutonomous);
    const targets = m.actors.filter(a => a.group === "targets");
    const dead = a => g.units.some(u => u.missionActor === a.id && u.hp <= 0);
    const guardsCleared = !c.clearTargets || targets.every(dead);
    if (update && guardsCleared) for (const node of c.nodes || []) {
      const actor = node.actor && g.units.find(u => u.missionActor === node.actor);
      if (node.actor && (!actor || actor.hp <= 0)) continue;
      const point = actor || node;
      if (!s.visited.includes(node.id) && units.some(u => G.dist(u, point) <= (c.kind === "recon" ? 3 : 1)))
        s.visited.push(node.id);
    }
    const current = c.kind === "kills" ? s.kills.filter(k => k.valid && k.ms).length :
      c.requiredAttackTargets ? targets.filter(a => s.kills.some(k => k.actor === a.id && k.valid)).length :
      c.nodes?.length ? s.visited.length : targets.filter(dead).length;
    const total = c.required ?? c.nodes?.length ?? targets.length;
    const extracted = !c.extraction || (units.length > 0 && units.every(u => inside(u,c.extraction)));
    const complete = current >= total && extracted;
    return {current, total, complete, extracted};
  }
  function poll(room, G) {
    const g = room.game, s = g.mission?.commission;
    if (!s) return;
    observe(room,G);
    const m = G.getMap(room.settings.mapId).mission, c = m.commission, p = progress(room,G,true);
    if(c.kind === "recon" && c.nodes.some(n => !s.visited.includes(n.id) && g.units.some(u => u.missionActor === n.actor && u.hp <= 0)))s.failed=true;
    if (s.failed || (c.deadlineRound && g.round > c.deadlineRound)) g.mission.requestedWinner = 1;
    else if (m.victory.type === "commission" && p.complete && (!c.surviveRound || g.round >= c.surviveRound))
      g.mission.requestedWinner = 0;
  }
  function commissionProgress(room,G,player) {
    const m = G.getMap(room.settings.mapId).mission, s = room.game.mission?.commission;
    if (!s || room.game.winner !== 0 || !s.participants.includes(player.id) || player.seat === null) return [];
    return [{id:m.contactTask,amount:1,...(m.commission.killReward ? {kills:s.kills.filter(k=>k.valid && k.ms).length} : {})}];
  }
  return {visible,unlocked,requireEntry,initialize,recordDefeat,observe,progress,poll,commissionProgress};
})();
if (typeof module !== "undefined") module.exports = MissionCommissions;
