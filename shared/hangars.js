/* 格纳库只保存现有单位的搭载关系；不复制单位，不恢复资源。 */
"use strict";
const UnitHangars = {
  create({
    modelOf,
    ownerOf,
    cells,
    fits,
    placementQuery = null,
    mapWidth,
    mapHeight,
    reachable,
    movementCost,
    sensors,
    captureObjective = () => null,
    squadMembers = (g, u) => [u],
    squadEligible = () => false,
    squadFits = members => members.length <= 6,
    environmentOf = (g, u) => u.environment,
    squadJoinTarget = () => null,
    joinSquad = () => {},
    deploymentCells = () => [],
  }) {
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
    const exposed = (u) => u?.embarked?.exposed === true;
    const slotCost = (u, h) => (h?.kind === "sfs" ? 1 : modelOf(u).transport?.slotCost || 1);
    function sync(g) {
      const units = new Map(g.units.map((u) => [u.id, u]));
      const done = new Set(),
        visiting = new Set();
      function follow(passenger) {
        if (!passenger?.embarked || done.has(passenger.id) || visiting.has(passenger.id)) return;
        visiting.add(passenger.id);
        const carrier = units.get(passenger.embarked.carrierId);
        if (carrier) {
          follow(carrier);
          const h = of(carrier).find((h) => h.id === passenger.embarked.hangarId);
          passenger.embarked.exposed = h?.kind === "sfs" && onMap(carrier);
          passenger.x = carrier.x;
          passenger.y = carrier.y;
        }
        visiting.delete(passenger.id);
        done.add(passenger.id);
      }
      for (const passenger of g.units) follow(passenger);
    }
    const used = (g, carrier, hangarId) =>
      cargo(g, carrier, hangarId).reduce(
        (sum, u) =>
          sum +
          slotCost(
            u,
            of(carrier).find((h) => h.id === u.embarked.hangarId),
          ),
        0,
      );
    const edgeDistance = (carrier, passenger, x = passenger.x, y = passenger.y) => {
      const a = cells(carrier),
        b = cells(passenger, x, y);
      return Math.min(
        ...b.map((p) => Math.min(...a.map((q) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y)))),
      );
    };
    function canEmbark(g, u, carrier, hangarId, deploymentDrop = false) {
      if (
        !onMap(u) ||
        modelOf(u).deployed ||
        !onMap(carrier) ||
        u.id === carrier.id ||
        u.team !== carrier.team ||
        g.winner !== null
      )
        return false;
      const hangar = of(carrier).find((h) => h.id === hangarId),
        transport = modelOf(u).transport;
      if (
        !hangar ||
        !transport ||
        !hangar.allowedTags.some((tag) => transport.loadTags.includes(tag)) ||
        used(g, carrier, hangarId) + slotCost(u, hangar) > hangar.capacity
      )
        return false;
      if (hangar.kind === "sfs") {
        const projected = { ...g, units: g.units.map(actor => actor.id === u.id
          ? { ...actor, embarked: { carrierId: carrier.id, hangarId, exposed: true } } : actor) };
        if (!squadFits(squadMembers(projected, carrier), projected)) return false;
      }
      if (deploying(g)) {
        const inDeploymentArea = deploymentDrop && deploymentCells(g, ownerOf(u), u).some(
          cell => cells(carrier).some(target => cell.x === target.x && cell.y === target.y));
        return !g.deployment[ownerOf(u)] && (edgeDistance(carrier, u) === 1 || inDeploymentArea);
      }
      return (
        u.team === g.team &&
        !u.acted &&
        !u.plan &&
        !u.snipeOrder &&
        !u.readySnipe &&
        u.lastLaunchRound !== g.round &&
        !u.pendingMove &&
        edgeDistance(carrier, u) === 1
      );
    }
    // Reserve every passenger before mutating the real board. Backtracking also
    // handles mixed squads and overlapping native hangar type restrictions.
    function boardingPlan(g, members, carrier, hangarId = null, deploymentDrop = false) {
      if (!members.length || new Set(members.map((u) => u.id)).size !== members.length) return null;
      const slots = of(carrier).filter((h) => !hangarId || h.id === hangarId);
      if (!slots.length || members.some((u) => !slots.some((h) => canEmbark(g, u, carrier, h.id, deploymentDrop))))
        return null;
      const view = { ...g, units: g.units.map((u) => ({ ...u })) };
      const plan = [];
      function assign(index) {
        if (index === members.length) return true;
        const passenger = members[index];
        const stored = view.units.find((u) => u.id === passenger.id);
        if (!stored) return false;
        for (const slot of slots) {
          if (!canEmbark(view, passenger, carrier, slot.id, deploymentDrop)) continue;
          stored.embarked = { carrierId: carrier.id, hangarId: slot.id };
          plan.push({ unitId: passenger.id, hangarId: slot.id });
          if (assign(index + 1)) return true;
          plan.pop();
          delete stored.embarked;
        }
        return false;
      }
      return assign(0) ? plan : null;
    }
    function embarkSquad(g, u, carrier, hangarId, single = false, deploymentDrop = false) {
      const members = single ? [u] : squadMembers(g, u);
      const plan = boardingPlan(g, members, carrier, hangarId, deploymentDrop);
      if (!plan) throw Error("格纳库无法容纳整队，或成员不满足搭乘条件");
      for (const item of plan)
        embark(
          g,
          members.find((member) => member.id === item.unitId),
          carrier,
          item.hangarId,
          deploymentDrop,
        );
      return {
        type: "embark",
        unitId: u.id,
        carrierId: carrier.id,
        hangarId,
        squadIds: members.map((member) => member.id),
      };
    }
    function embark(g, u, carrier, hangarId, deploymentDrop = false) {
      if (!canEmbark(g, u, carrier, hangarId, deploymentDrop))
        throw Error("无法搭载：容量、类型、距离或行动条件不满足");
      const h = of(carrier).find((h) => h.id === hangarId);
      delete u.squadId;
      delete u.squadSlot;
      u.embarked = {
        carrierId: carrier.id,
        hangarId,
        boardRound: deploying(g) ? null : g.round,
        ...(h.kind === "sfs" ? { exposed: true } : {}),
      };
      sync(g);
      u.origin = null;
      if (!deploying(g)) {
        u.acted = true;
        u.moved = true;
      }
      return { type: "embark", unitId: u.id, carrierId: carrier.id, hangarId };
    }
    function launchCells(g, u, emergency = false) {
      if (!u?.embarked || u.hp <= 0 || g.winner !== null || (!emergency && exposed(u) && u.moved))
        return [];
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
              (fits(
                view,
                passenger,
                p.x,
                p.y,
                passenger.angle,
                false,
                deploying(g) ? ownerOf(u) : null,
              ) ||
                (p.squadTarget &&
                  (!deploying(g) ||
                    cells(passenger, p.x, p.y).every((cell) =>
                      deploymentCells(g, ownerOf(u), passenger).some(
                        (allowed) => allowed.x === cell.x && allowed.y === cell.y,
                      ),
                    )))),
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
    function prepareLaunch(g, u, x, y) {
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
      return { carrierId, from, path };
    }
    function launchAngle(path, from, x, y, fallback) {
      const previous = [...path].reverse().find((point) => point.x !== x || point.y !== y) || from;
      return previous.x === x && previous.y === y
        ? fallback
        : (Math.atan2(x - previous.x, -(y - previous.y)) * 180) / Math.PI;
    }
    function previewLaunch(g, u, x, y, seat = u.ownerSeat ?? u.team) {
      if (g.units.some((actor) => actor.pendingMove?.seat === seat) || u.pendingMove)
        throw Error("请先确认或取消移动");
      const plan = prepareLaunch(g, u, x, y);
      const angle = launchAngle(plan.path, plan.from, x, y, u.angle);
      u.pendingMove = { x, y, angle, seat, launch: true, ...plan };
      return { type: "move_preview", unitId: u.id, ...plan, x, y };
    }
    function launch(g, u, x, y) {
      const { carrierId, from, path } = prepareLaunch(g, u, x, y);
      delete u.embarked;
      Object.assign(u, { x, y, angle: launchAngle(path, from, x, y, u.angle), origin: null });
      const target = squadJoinTarget(g, u, x, y, [u]);
      if (target) joinSquad(g, u, target);
      if (!deploying(g)) {
        u.moved = true;
        u.lastLaunchRound = g.round;
        const carrier = g.units.find((c) => c.id === carrierId);
        if (carrier) {
          carrier.origin = null;
          carrier.lastCargoLaunchRound = g.round;
        }
      }
      sync(g);
      return { type: "launch", unitId: u.id, carrierId, x, y, from, path };
    }
    function launchSquadCells(g, members) {
      if (!members.length || !squadFits(members, g)) return [];
      const root = members[0];
      if (
        members.length > 1 &&
        members.some(
          (u) =>
            !squadEligible({ ...u, embarked: undefined }) ||
            ownerOf(u) !== ownerOf(root) ||
            environmentOf(g, u) !== environmentOf(g, root) ||
            !!u.flying !== !!root.flying,
        )
      )
        return [];
      const routes = members.map((u) => launchCells(g, u)),
        others = routes.slice(1).map((cells) => new Set(cells.map((c) => c.x + "," + c.y)));
      return routes[0].filter(
        (c) =>
          others.every((keys) => keys.has(c.x + "," + c.y)) &&
          (!c.squadTarget ||
            squadFits([...members, ...squadMembers(g, g.units.find(u => u.id === c.squadTarget))], g)),
      );
    }
    function launchGroupPlan(g, members, x, y) {
      if (
        !members.length ||
        !squadFits(members, g) ||
        new Set(members.map((u) => u.id)).size !== members.length
      )
        throw Error("请选择不超过6台且合计不超过6容量点的出击单位");
      const root = members[0],
        carrierId = root.embarked?.carrierId;
      if (
        !carrierId ||
        members.some(
          (u) =>
            u.embarked?.carrierId !== carrierId ||
            ownerOf(u) !== ownerOf(root) ||
            u.team !== root.team ||
            u.pendingMove,
        )
      )
        throw Error("请选择同一格纳库中由你控制的单位");
      if (
        members.length > 1 &&
        members.some(
          (u) => modelOf(u).ship || modelOf(u).largeUnit || cells(u).length !== 1 || of(u).length,
        )
      )
        throw Error("这些单位不能组成同一小队");
      const staged = { ...g, units: structuredClone(g.units) };
      const plans = members.map((u) => prepareLaunch(g, u, x, y));
      for (const member of members) {
        const actor = staged.units.find((u) => u.id === member.id);
        delete actor.pendingMove;
        launch(staged, actor, x, y);
      }
      // Every selected unit must end in the same squad, including environment/size rules.
      if (members.length > 1) {
        const first = staged.units.find((u) => u.id === root.id);
        const joined = new Set(squadMembers(staged, first).map((u) => u.id));
        if (members.some((u) => !joined.has(u.id))) throw Error("所选单位无法组成同一小队");
      }
      return plans;
    }
    function previewLaunchSquad(g, members, x, y, seat = ownerOf(members[0])) {
      if (g.units.some((u) => u.pendingMove?.seat === seat)) throw Error("请先确认或取消移动");
      const plans = launchGroupPlan(g, members, x, y),
        root = members[0];
      const squadIds = members.map((u) => u.id),
        squadPaths = Object.fromEntries(members.map((u, i) => [u.id, plans[i].path]));
      members.forEach((u, i) => {
        u.pendingMove = {
          ...plans[i],
          x,
          y,
          seat,
          launch: true,
          angle: launchAngle(plans[i].path, plans[i].from, x, y, u.angle),
          ...(i ? { launchMemberOf: root.id } : { squadLaunchIds: squadIds, squadIds, squadPaths }),
        };
      });
      return { type: "move_preview", unitId: root.id, ...plans[0], x, y, squadIds, squadPaths };
    }
    function launchSquad(g, members, x, y) {
      launchGroupPlan(g, members, x, y);
      const events = members.map((u) => launch(g, u, x, y));
      return {
        ...events[0],
        squadIds: members.map((u) => u.id),
        squadPaths: Object.fromEntries(events.map((e) => [e.unitId, e.path])),
      };
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
          onMap(enemy) && enemy.team !== carrier.team && edgeDistance(carrier, enemy) <= range,
      );
    }
    function shouldLaunch(g, u) {
      const carrier = g.units.find((c) => c.id === u.embarked?.carrierId);
      return (
        !!carrier &&
        readyToLaunch(u) &&
        (inContact(g, carrier) || !!captureObjective(g, u, carrier))
      );
    }
    function needsRecovery(u) {
      const m = modelOf(u);
      const damaged = Object.values(u.brokenParts || {}).some(Boolean);
      const energyWeapons = m.weapons.filter((weapon) => weapon.slot !== "skill" && weapon.en > 0);
      const outOfAmmo =
        energyWeapons.length > 0 && energyWeapons.every((weapon) => weapon.en > u.en);
      return u.hp < m.hp * 0.25 || u.en < m.en * 0.5 || outOfAmmo || damaged;
    }
    function recoveryOrder(g, u) {
      if (!onMap(u) || u.acted || u.plan || u.lastLaunchRound === g.round) return null;
      const m = modelOf(u);
      if (!m.transport?.loadTags?.length) return null;
      // Check actual carriers before distance/contact searches. A normal ally is
      // never a boarding destination, regardless of its proximity to the enemy.
      const carriers = g.units.filter(c => c.id !== u.id && onMap(c) && c.team === u.team && of(c).length);
      if (!carriers.length) return null;
      const members = squadMembers(g, u);
      if (members.some((member) => member.acted || member.plan || member.pendingMove)) return null;
      const repair = members.some(needsRecovery);
      const enemies = g.units.filter((e) => onMap(e) && e.team !== u.team);
      const distance = Math.min(...enemies.map((e) => edgeDistance(u, e)));
      const longJourney = enemies.length > 0 && distance > m.move * 2 + attackReach(u);
      // Healthy capturers finish nearby objectives before boarding for a long trip.
      if (!repair && captureObjective(g, u, u)) return null;
      if (!repair && !longJourney) return null;
      const candidates = carriers.filter(
        (c) =>
          of(c).some(
            (h) =>
              (!repair || h.kind !== "sfs") &&
              members.every((member) =>
                h.allowedTags.some((tag) => modelOf(member).transport?.loadTags.includes(tag)),
              ) &&
              used(g, c, h.id) + members.reduce((sum, member) => sum + slotCost(member, h), 0) <=
                h.capacity,
          ) &&
          (repair ||
            (!inContact(g, c) &&
              edgeDistance(c, u) <= Math.max(1, m.move) &&
              (modelOf(c).move > m.move || ["air", "hover"].includes(modelOf(c).movementType)))),
      );
      candidates.sort((a, b) => edgeDistance(a, u) - edgeDistance(b, u));
      for (const c of candidates)
        for (const h of of(c))
          if (boardingPlan(g, members, c, h.id))
            return { action: "embark", fields: { unitId: u.id, carrierId: c.id, hangarId: h.id } };
      if (!candidates.length) return null;
      if (u.moved) return { action: "wait", fields: { unitId: u.id } };
      const walk = reachable(g, u);
      const boardingRoutes = [...walk.values()].filter(
        (route) =>
          route.boarding && candidates.some((carrier) => carrier.id === route.boarding.carrierId),
      );
      boardingRoutes.sort((a, b) => a.cost - b.cost);
      if (boardingRoutes.length) {
        const point = boardingRoutes[0];
        return { action: "move", fields: { unitId: u.id, x: point.x, y: point.y } };
      }
      // Search from all carrier edges to avoid steering into a dead end around terrain.
      const occupancy = placementQuery?.(g);
      const canFit = (x, y, throughAllies = false) => occupancy
        ? occupancy.fits(u, x, y, u.angle, throughAllies)
        : fits(g, u, x, y, u.angle, throughAllies);
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
            if (!distances.has(key) && canFit(x, y, true)) {
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
          if (!distances.has(key) && canFit(x, y, true)) {
            distances.set(key, distance);
            queue.push({ x, y });
          }
        }
      }
      const current = distances.get(u.x + "," + u.y) ?? Infinity;
      const options = [...walk.values()].filter(
        (p) => canFit(p.x, p.y) && (distances.get(p.x + "," + p.y) ?? Infinity) < current,
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
      sync(g);
      const depth = (u) => {
        const seen = new Set();
        while (u?.embarked && !seen.has(u.id)) {
          seen.add(u.id);
          u = g.units.find((c) => c.id === u.embarked.carrierId);
        }
        return seen.size;
      };
      // Resolve outer carriers first, including a nested carrier destroyed during evacuation.
      const passengers = g.units
        .filter((u) => u.hp > 0 && u.embarked)
        .sort((a, b) => depth(a) - depth(b));
      for (const u of passengers) {
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
          acted: u.acted || u.hp <= 0,
          moved: true,
          forcedExitRound: g.round,
          origin: null,
          lastLaunchRound: g.round,
        });
        events.push({ unitId: u.id, carrierId, x: u.x, y: u.y, hp: u.hp, escaped: u.hp > 0 });
      }
      sync(g);
      return events;
    }
    return {
      exposed,
      slotCost,
      sync,
      of,
      cargo,
      used,
      canEmbark,
      embark,
      boardingPlan,
      embarkSquad,
      launchCells,
      launchSquadCells,
      launch,
      previewLaunch,
      previewLaunchSquad,
      launchSquad,
      evacuate,
      readyToLaunch,
      shouldLaunch,
      recoveryOrder,
      needsRecovery,
    };
  },
};
if (typeof module !== "undefined") module.exports = UnitHangars;
