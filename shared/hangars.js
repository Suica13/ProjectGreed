/* 格纳库只保存现有单位的搭载关系；不复制单位，不恢复资源。 */
"use strict";
const UnitHangars = {
  create({ modelOf, ownerOf, cells, fits, mapWidth, mapHeight, reachable, movementCost, sensors }) {
    const onMap = (u) => !!u && u.hp > 0 && !u.embarked;
    const deploying = (g) => !!g.deployment && !g.deployment.every(Boolean);
    const of = (u) => modelOf(u).hangars || [];
    const cargo = (g, carrier, hangarId = null) =>
      g.units.filter(
        (u) =>
          u.hp > 0 &&
          u.embarked?.carrierId === carrier.id &&
          (!hangarId || u.embarked.hangarId === hangarId),
      );
    const used = (g, carrier, hangarId) =>
      cargo(g, carrier, hangarId).reduce(
        (sum, u) => sum + (modelOf(u).transport?.slotCost || 1),
        0,
      );
    const edgeDistance = (carrier, passenger, x = passenger.x, y = passenger.y) => {
      const a = cells(carrier),
        b = cells(passenger, x, y);
      return Math.min(
        ...b.map((p) => Math.min(...a.map((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y)))),
      );
    };
    function canEmbark(g, u, carrier, hangarId) {
      if (
        !onMap(u) ||
        !onMap(carrier) ||
        u === carrier ||
        u.team !== carrier.team ||
        of(u).length ||
        g.winner !== null
      )
        return false;
      const hangar = of(carrier).find((h) => h.id === hangarId),
        transport = modelOf(u).transport;
      if (
        !hangar ||
        !transport ||
        !hangar.allowedTags.some((tag) => transport.loadTags.includes(tag)) ||
        used(g, carrier, hangarId) + transport.slotCost > hangar.capacity
      )
        return false;
      if (deploying(g)) return !g.deployment[ownerOf(u)] && edgeDistance(carrier, u) === 1;
      return (
        u.team === g.team &&
        !u.acted &&
        !u.plan &&
        !u.snipeOrder &&
        !u.readySnipe &&
        u.lastLaunchRound !== g.round &&
        edgeDistance(carrier, u) === 1
      );
    }
    function embark(g, u, carrier, hangarId) {
      if (!canEmbark(g, u, carrier, hangarId))
        throw Error("无法搭载：容量、类型、距离或行动条件不满足");
      u.embarked = { carrierId: carrier.id, hangarId, boardRound: deploying(g) ? null : g.round };
      u.origin = null;
      if (!deploying(g)) {
        u.acted = true;
        u.moved = true;
        u.actionPoints = 0;
      }
      return { type: "embark", unitId: u.id, carrierId: carrier.id, hangarId };
    }
    function launchCells(g, u, emergency = false) {
      if (!u?.embarked || u.hp <= 0 || g.winner !== null) return [];
      const carrier = g.units.find((c) => c.id === u.embarked.carrierId);
      if (!carrier || (!emergency && !onMap(carrier))) return [];
      if (
        !emergency &&
        (deploying(g)
          ? g.deployment[ownerOf(u)]
          : u.team !== g.team || u.acted || u.embarked.boardRound === g.round)
      )
        return [];
      if (!emergency) {
        // Launch is a movement from any legal hull-edge cell, using the passenger's terrain/ZOC costs.
        const passenger = { ...u, embarked: undefined },
          view = { ...g, units: g.units.map((other) => (other.id === u.id ? passenger : other)) },
          starts = [],
          seen = new Set();
        for (const hullCell of cells(carrier))
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const x = hullCell.x + dx,
              y = hullCell.y + dy,
              key = x + "," + y;
            if (
              seen.has(key) ||
              edgeDistance(carrier, passenger, x, y) !== 1 ||
              !fits(view, passenger, x, y, passenger.angle, true)
            )
              continue;
            seen.add(key);
            starts.push({ x, y, cost: movementCost(view, passenger, x, y), path: [{ x, y }] });
          }
        return [...reachable(view, passenger, starts).values()]
          .filter(
            (p) =>
              edgeDistance(carrier, passenger, p.x, p.y) >= 1 &&
              fits(
                view,
                passenger,
                p.x,
                p.y,
                passenger.angle,
                false,
                deploying(g) ? ownerOf(u) : null,
              ),
          )
          .map((p) => ({ ...p, distance: edgeDistance(carrier, passenger, p.x, p.y) }))
          .sort((a, b) => a.cost - b.cost || a.y - b.y || a.x - b.x);
      }
      const definition = of(carrier).find((h) => h.id === u.embarked.hangarId);
      const range = emergency ? (definition?.emergencyRange ?? 3) : (definition?.launchRange ?? 1),
        hull = cells(carrier);
      const left = Math.max(0, Math.min(...hull.map((c) => c.x)) - range - 2),
        right = Math.min(mapWidth(g) - 1, Math.max(...hull.map((c) => c.x)) + range),
        top = Math.max(0, Math.min(...hull.map((c) => c.y)) - range - 2),
        bottom = Math.min(mapHeight(g) - 1, Math.max(...hull.map((c) => c.y)) + range);
      const result = [];
      for (let y = top; y <= bottom; y++)
        for (let x = left; x <= right; x++) {
          const distance = edgeDistance(carrier, u, x, y);
          // 即使舰体已毁，也不能把紧急退出位置放在原舰体内部。
          if (
            distance < 1 ||
            distance > range ||
            !fits(g, u, x, y, u.angle, false, !emergency && deploying(g) ? ownerOf(u) : null)
          )
            continue;
          result.push({ x, y, distance });
        }
      return result.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);
    }
    function launch(g, u, x, y) {
      const destination =
        Number.isInteger(x) && Number.isInteger(y)
          ? launchCells(g, u).find((c) => c.x === x && c.y === y)
          : null;
      if (!destination) throw Error("请选择单位移动范围内的有效出击格子");
      const carrierId = u.embarked.carrierId,
        carrier = g.units.find((c) => c.id === carrierId),
        hull = cells(carrier),
        passengerCells = cells(u),
        average = (list, axis) => list.reduce((sum, c) => sum + c[axis], 0) / list.length,
        from = {
          x: average(hull, "x") - (average(passengerCells, "x") - u.x),
          y: average(hull, "y") - (average(passengerCells, "y") - u.y),
        },
        route = destination.path || [{ x, y }],
        first = route[0],
        segments = Math.max(1, Math.ceil(Math.hypot(first.x - from.x, first.y - from.y))),
        path = Array.from({ length: segments }, (_, i) => ({
          x: from.x + ((first.x - from.x) * (i + 1)) / segments,
          y: from.y + ((first.y - from.y) * (i + 1)) / segments,
        })).concat(route.slice(1));
      delete u.embarked;
      Object.assign(u, { x, y, origin: null });
      if (!deploying(g)) {
        u.moved = true;
        u.lastLaunchRound = g.round;
        u.actionPoints = Math.ceil((u.actionPoints ?? modelOf(u).actionPoints ?? 5) * 0.75);
        const carrier = g.units.find((c) => c.id === carrierId);
        if (carrier) {
          carrier.origin = null;
          carrier.lastCargoLaunchRound = g.round;
        }
      }
      return { type: "launch", unitId: u.id, carrierId, x, y, from, path };
    }
    function readyToLaunch(u) {
      const m = modelOf(u);
      return (
        u.hp >= m.hp * 0.75 &&
        u.en >= m.en * 0.75 &&
        !Object.values(u.brokenParts || {}).some(Boolean)
      );
    }
    const attackReach = (u) =>
      Math.max(
        1,
        ...modelOf(u)
          .weapons.filter((w) => w.slot !== "skill")
          .map((w) => w.max),
      );
    function inContact(g, carrier) {
      const range = Math.max(6, attackReach(carrier));
      return g.units.some(
        (enemy) =>
          onMap(enemy) &&
          enemy.team !== carrier.team &&
          sensors.visible(g, carrier.team, enemy) &&
          edgeDistance(carrier, enemy) <= range,
      );
    }
    function shouldLaunch(g, u) {
      const carrier = g.units.find((c) => c.id === u.embarked?.carrierId);
      return !!carrier && readyToLaunch(u) && inContact(g, carrier);
    }
    function recoveryOrder(g, u) {
      if (!onMap(u) || of(u).length || u.acted || u.plan || u.lastLaunchRound === g.round)
        return null;
      const m = modelOf(u);
      const damaged = Object.values(u.brokenParts || {}).some(Boolean);
      const repair = u.hp < m.hp * 0.25 || u.en < m.en * 0.25 || damaged;
      const enemies = g.units.filter((e) => onMap(e) && e.team !== u.team);
      const distance = Math.min(...enemies.map((e) => edgeDistance(u, e)));
      const longJourney = enemies.length > 0 && distance > m.move * 2 + attackReach(u);
      if (!repair && !longJourney) return null;
      const candidates = g.units.filter(
        (c) =>
          onMap(c) &&
          c.team === u.team &&
          (repair ||
            (!inContact(g, c) &&
              edgeDistance(c, u) <= Math.max(1, m.move) &&
              (modelOf(c).move > m.move || ["air", "hover"].includes(modelOf(c).movementType)))) &&
          of(c).some(
            (h) =>
              h.allowedTags.some((tag) => m.transport?.loadTags.includes(tag)) &&
              used(g, c, h.id) + (m.transport?.slotCost || 1) <= h.capacity,
          ),
      );
      for (const c of candidates)
        for (const h of of(c))
          if (canEmbark(g, u, c, h.id))
            return { action: "embark", fields: { unitId: u.id, carrierId: c.id, hangarId: h.id } };
      if (!candidates.length) return null;
      if (u.moved) return { action: "wait", fields: { unitId: u.id } };
      // Search from all carrier edges to avoid steering into a dead end around terrain.
      const distances = new Map(),
        queue = [];
      for (const c of candidates)
        for (const cell of cells(c))
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const x = cell.x + dx,
              y = cell.y + dy,
              key = x + "," + y;
            if (!distances.has(key) && fits(g, u, x, y, u.angle, true)) {
              distances.set(key, 0);
              queue.push({ x, y });
            }
          }
      for (let i = 0; i < queue.length; i++) {
        const n = queue[i],
          distance = distances.get(n.x + "," + n.y) + 1;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const x = n.x + dx,
            y = n.y + dy,
            key = x + "," + y;
          if (!distances.has(key) && fits(g, u, x, y, u.angle, true)) {
            distances.set(key, distance);
            queue.push({ x, y });
          }
        }
      }
      const current = distances.get(u.x + "," + u.y) ?? Infinity;
      const options = [...reachable(g, u).values()].filter(
        (p) => fits(g, u, p.x, p.y) && (distances.get(p.x + "," + p.y) ?? Infinity) < current,
      );
      options.sort(
        (a, b) =>
          distances.get(a.x + "," + a.y) - distances.get(b.x + "," + b.y) || a.cost - b.cost,
      );
      const point = options[0];
      return point ? { action: "move", fields: { unitId: u.id, x: point.x, y: point.y } } : null;
    }
    function evacuate(g) {
      const events = [];
      for (const u of g.units.filter((u) => u.hp > 0 && u.embarked)) {
        const carrier = g.units.find((c) => c.id === u.embarked.carrierId);
        if (carrier?.hp > 0) continue;
        const carrierId = u.embarked.carrierId,
          m = modelOf(u),
          point = launchCells(g, u, true)[0];
        u.hp = Math.max(0, u.hp - Math.round(m.hp * 0.25));
        u.shield = Math.max(0, (u.shield || 0) - Math.round((m.shield?.hp || 0) * 0.25));
        delete u.embarked;
        if (point && u.hp > 0) {
          u.x = point.x;
          u.y = point.y;
        } else {
          u.hp = 0;
          u.x = carrier?.x ?? u.x;
          u.y = carrier?.y ?? u.y;
        }
        Object.assign(u, {
          acted: true,
          moved: true,
          actionPoints: 0,
          origin: null,
          lastLaunchRound: g.round,
        });
        events.push({ unitId: u.id, carrierId, x: u.x, y: u.y, hp: u.hp, escaped: u.hp > 0 });
      }
      return events;
    }
    return {
      of,
      cargo,
      used,
      canEmbark,
      embark,
      launchCells,
      launch,
      evacuate,
      readyToLaunch,
      shouldLaunch,
      recoveryOrder,
    };
  },
};
if (typeof module !== "undefined") module.exports = UnitHangars;
