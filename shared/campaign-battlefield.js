/* Shared strategic battlefield objectives. Only room-engine may commit these operations. */
"use strict";
const CampaignBattlefield = (() => {
  const cache = new WeakMap();
  const key = (x, y) => x + "," + y;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  function create(G, state, regionId, scenarioId = "earth_0079_mid") {
    const scenario = G.catalog.scenarios[scenarioId];
    const layout = scenario?.regions[regionId]?.layout;
    if (!layout?.nodes || !layout?.gates || !layout?.links) throw Error("区块缺少据点地图配置");
    const defender = state.regions.find((r) => r.id === regionId).owner;
    return {
      scenarioId,
      regionId,
      defender,
      layout: clone(layout),
      version: 0,
      owners: Object.fromEntries(layout.nodes.map((n) => [n.id, defender])),
      adjacentOwners: Object.fromEntries(
        layout.gates.map((g) => [
          g.region,
          state.regions.find((r) => r.id === g.region)?.owner ?? null,
        ]),
      ),
      capturedBaseTeam: null,
    };
  }
  function network(g) {
    const field = g.campaignBattlefield;
    if (!field) return null;
    const previous = cache.get(field);
    if (previous?.version === field.version) return previous;
    const nodes = [...field.layout.nodes, ...field.layout.gates];
    const lookup = new Map(nodes.map((n) => [n.id, n]));
    const owner = (n) => (n.region ? field.adjacentOwners[n.region] : field.owners[n.id]);
    const reached = [new Set(), new Set()];
    for (const team of [0, 1]) {
      const pending = nodes.filter((n) => owner(n) === team && (n.kind === "base" || n.region));
      for (const node of pending) reached[team].add(node.id);
      for (let i = 0; i < pending.length; i++) {
        for (const line of field.layout.links) {
          const id = line.a === pending[i].id ? line.b : line.b === pending[i].id ? line.a : null;
          if (!id || reached[team].has(id) || owner(lookup.get(id)) !== team) continue;
          reached[team].add(id);
          pending.push(lookup.get(id));
        }
      }
    }
    const roads = [new Set(), new Set()];
    const lines = field.layout.links.map((line) => {
      const a = lookup.get(line.a),
        b = lookup.get(line.b);
      const team = [0, 1].find((t) => reached[t].has(a.id) && reached[t].has(b.id));
      if (team !== undefined) {
        const steps = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), 1);
        for (let i = 0; i <= steps; i++) {
          const x = Math.round(a.x + ((b.x - a.x) * i) / steps),
            y = Math.round(a.y + ((b.y - a.y) * i) / steps);
          for (const [dx, dy] of [
            [0, 0],
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ])
            roads[team].add(key(x + dx, y + dy));
        }
      }
      return { ...line, a, b, team: team ?? null };
    });
    const result = { version: field.version, nodes, lookup, reached, roads, lines };
    cache.set(field, result);
    return result;
  }
  function nodeAt(G, g, u) {
    const nodes = g.campaignBattlefield?.layout.nodes || [];
    return nodes.find((node) => G.cells(u).some((cell) => Math.max(Math.abs(cell.x - node.x), Math.abs(cell.y - node.y)) <= 1));
  }
  function canCapture(G, g, u) {
    if (
      !g.campaignBattlefield ||
      !u ||
      !G.onMap(u) ||
      u.embarked ||
      u.pendingMove ||
      u.plan ||
      u.flying ||
      G.modelOf(u).movementType === "air" ||
      G.actionPoints(u) < 5 ||
      u.team !== g.team ||
      u.acted
    )
      return null;
    const node = nodeAt(G, g, u);
    return node && g.campaignBattlefield.owners[node.id] !== u.team ? node : null;
  }
  function capture(G, g, u) {
    const node = canCapture(G, g, u);
    if (!node) throw Error("无法占领：需地面单位位于敌方据点内并保有5AP");
    u.actionPoints = G.actionPoints(u) - 5;
    g.campaignBattlefield.owners[node.id] = u.team;
    g.campaignBattlefield.version++;
    if (node.kind === "base") {
      g.campaignBattlefield.capturedBaseTeam = u.team;
      g.winner = u.team;
    }
    return node;
  }
  function onSupply(g, u, x, y) {
    return !!network(g)?.roads[u.team]?.has(key(x, y));
  }
  function heal(G, g) {
    const net = network(g);
    if (!net) return;
    for (const u of g.units.filter((u) => G.onMap(u) && u.team === g.team && !u.embarked)) {
      const node = nodeAt(G, g, u);
      if (!node || !net.reached[u.team].has(node.id)) continue;
      const m = G.modelOf(u),
        base = node.kind === "base";
      u.hp = Math.min(m.hp, u.hp + Math.round(m.hp * (base ? 0.2 : 0.15)));
      u.en = Math.min(m.en, u.en + Math.ceil(m.en * (base ? 0.4 : 0.3)));
    }
  }
  function deploymentCells(G, g, u, fromRegion = null) {
    const f = g.campaignBattlefield;
    if (!f) return null;
    const net = network(g);
    let zones;
    if (u.team === f.defender) zones = f.layout.nodes.filter((n) => f.owners[n.id] === u.team);
    else {
      const gate =
        f.layout.gates.find((n) => n.region === (fromRegion || u.campaignEntry)) ||
        (!fromRegion && !u.campaignEntry
          ? f.layout.gates.find((n) => f.adjacentOwners[n.region] === u.team)
          : null);
      zones = gate ? [gate] : [];
    }
    const cells = new Map();
    for (const zone of zones) {
      const radius = zone.deploymentRadius;
      for (
        let y = Math.max(0, zone.y - radius);
        y < Math.min(G.mapHeight(g), zone.y + radius + 1);
        y++
      )
        for (
          let x = Math.max(0, zone.x - radius);
          x < Math.min(G.mapWidth(g), zone.x + radius + 1);
          x++
        )
          if (distance({ x, y }, zone) <= radius)
            cells.set(key(x, y), {
              x,
              y,
              priority: zone.kind === "base" ? 0 : 1,
              distance: distance({ x, y }, zone),
            });
    }
    return [...cells.values()].sort(
      (a, b) => a.priority - b.priority || a.distance - b.distance || a.y - b.y || a.x - b.x,
    );
  }
  const deploymentSeat = (g, u) =>
    g.campaignBattlefield?.deploymentControllers?.[u.ownerSeat ?? u.team] ?? u.ownerSeat ?? u.team;
  function exits(G, g, u) {
    if (!g.campaignBattlefield || !u || !G.onMap(u) || u.embarked || u.pendingMove || u.plan)
      return [];
    return g.campaignBattlefield.layout.gates.filter((gate) =>
      G.cells(u).some((cell) => distance(cell, gate) <= gate.radius),
    );
  }
  function validateLayout(layout, map, region) {
    const fail = () => {
      throw Error("区块据点地图配置无效：" + region.id);
    };
    if (
      !layout ||
      !Array.isArray(layout.nodes) ||
      !Array.isArray(layout.gates) ||
      !Array.isArray(layout.links)
    )
      fail();
    const all = [...layout.nodes, ...layout.gates],
      ids = new Set(all.map((node) => node.id));
    if (
      ids.size !== all.length ||
      layout.nodes.filter((node) => node.kind === "base").length !== 1 ||
      layout.nodes.filter((node) => node.kind === "outpost").length < 4 ||
      layout.nodes.filter((node) => node.kind === "outpost").length > 8 ||
      all.some(
        (node) =>
          typeof node.id !== "string" ||
          !Number.isInteger(node.x) ||
          !Number.isInteger(node.y) ||
          node.x < 0 ||
          node.y < 0 ||
          node.x >= map.width ||
          node.y >= map.height ||
          !Number.isInteger(node.radius) ||
          node.radius < 1 ||
          !Number.isInteger(node.deploymentRadius) ||
          node.deploymentRadius < node.radius,
      )
    )
      fail();
    if (
      layout.gates.length !== region.links.length ||
      new Set(layout.gates.map((node) => node.region)).size !== region.links.length ||
      layout.gates.some((node) => !region.links.includes(node.region))
    )
      fail();
    if (layout.links.some((line) => !ids.has(line.a) || !ids.has(line.b) || line.a === line.b))
      fail();
    const reached = new Set([layout.nodes.find((node) => node.kind === "base").id]);
    for (let i = 0; i < all.length; i++)
      for (const line of layout.links) {
        if (reached.has(line.a)) reached.add(line.b);
        if (reached.has(line.b)) reached.add(line.a);
      }
    if (reached.size !== all.length) fail();
  }
  function validate(G, g) {
    const f = g.campaignBattlefield;
    if (!f) return;
    const entry = G.catalog.scenarios[f.scenarioId]?.regions[f.regionId],
      source = entry?.layout;
    if (source?.nodes && f.layout?.nodes) {
      const migrated = clone(f.layout);
      for (const node of migrated.nodes)
        if (node.radius === (node.kind === "base" ? 3 : 2)) node.radius = 1;
      if (JSON.stringify(migrated) === JSON.stringify(source)) f.layout = migrated;
    }
    if (
      entry?.mapId !== g.mapId ||
      !source?.nodes ||
      JSON.stringify(f.layout) !== JSON.stringify(source) ||
      ![0, 1].includes(f.defender) ||
      !Number.isSafeInteger(f.version) ||
      f.version < 0 ||
      (f.capturedBaseTeam !== null && ![0, 1].includes(f.capturedBaseTeam)) ||
      source.nodes.some((n) => ![0, 1].includes(f.owners?.[n.id])) ||
      source.gates.some((n) => ![0, 1].includes(f.adjacentOwners?.[n.region]))
    )
      throw Error("据点与补给线存档无效");
  }
  return {
    create,
    network,
    nodeAt,
    canCapture,
    capture,
    onSupply,
    heal,
    deploymentCells,
    deploymentSeat,
    exits,
    validateLayout,
    validate,
  };
})();
if (typeof module !== "undefined") module.exports = CampaignBattlefield;
