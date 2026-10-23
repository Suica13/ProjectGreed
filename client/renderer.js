/* MOD 素材绘制器，只处理贴图、骨骼和关键帧。
 * 外部调用 draw(ctx, model, x, y, scale, ...)。演出大小在 battle-scene.js 调整。
 */
"use strict";
const SpriteRenderer = (() => {
  const models = Object.fromEntries(ART.units.map((u) => [u.id, u])),
    images = {};
  // 读取 MOD 的简单条件表达式（例如装备可见条件），不执行任意 JS。
  function expression(src, vars) {
    src = String(src)
      .replace(/^\s*if\s+/i, "")
      .replace(/self\.resource\(\)/gi, "resource")
      .replace(/self\.resource/gi, "resource");
    let tokens =
        src.match(
          /(?:\d*\.\d+|\d+(?:\.\d*)?)|(?:[A-Za-z_][\w.]*)|(?:==|!=|<=|>=|&&|\|\||[()+*/,<>!\-])/g,
        ) || [],
      pos = 0,
      pri = {
        or: 1,
        "||": 1,
        and: 2,
        "&&": 2,
        "==": 3,
        "!=": 3,
        "<": 4,
        ">": 4,
        "<=": 4,
        ">=": 4,
        "+": 5,
        "-": 5,
        "*": 6,
        "/": 6,
      };
    function atom() {
      let x = tokens[pos++];
      if (x === undefined) throw Error("expression");
      if (x === "(") {
        let v = parse(0);
        pos++;
        return v;
      }
      if (x === "not" || x === "!") return !parse(7);
      if (x === "-") return -parse(7);
      if (x === "+") return +parse(7);
      if (/^\d|^\./.test(x)) return Number(x);
      let k = x.toLowerCase();
      if (k === "true") return true;
      if (k === "false") return false;
      if (tokens[pos] === "(") {
        pos++;
        let args = [];
        if (tokens[pos] !== ")")
          do {
            args.push(parse(0));
            if (tokens[pos] !== ",") break;
            pos++;
          } while (true);
        pos++;
        if (k === "select") return args[0] ? args[1] : args[2];
        if (k === "squareroot") return Math.sqrt(args[0]);
        return 0;
      }
      return vars[k] ?? 0;
    }
    function parse(min) {
      let a = atom();
      while (pos < tokens.length) {
        let op = tokens[pos].toLowerCase(),
          p = pri[op];
        if (p === undefined || p < min) break;
        pos++;
        let b = parse(p + 1);
        switch (op) {
          case "or":
          case "||":
            a = Boolean(a || b);
            break;
          case "and":
          case "&&":
            a = Boolean(a && b);
            break;
          case "==":
            a = a === b;
            break;
          case "!=":
            a = a !== b;
            break;
          case "<":
            a = a < b;
            break;
          case ">":
            a = a > b;
            break;
          case "<=":
            a = a <= b;
            break;
          case ">=":
            a = a >= b;
            break;
          case "+":
            a += b;
            break;
          case "-":
            a -= b;
            break;
          case "*":
            a *= b;
            break;
          case "/":
            a /= b;
            break;
        }
      }
      return a;
    }
    return parse(0);
  }
  const val = (v, vars, f = 0) => (v === undefined ? f : Number(expression(v, vars)));
  // 关键帧之间线性插值，得到时刻 t 的骨骼位置、方向和高度。
  function sample(anim, t) {
    let result = {};
    for (const [bone, fields] of Object.entries(anim?.curves || {})) {
      result[bone] = {};
      for (const [field, points] of Object.entries(fields)) {
        let v = points.at(-1)[1];
        if (t <= points[0][0]) v = points[0][1];
        else
          for (let i = 0; i < points.length - 1; i++) {
            let [ta, va] = points[i],
              [tb, vb] = points[i + 1];
            if (t >= ta && t <= tb) {
              v = va + ((vb - va) * (t - ta)) / (tb - ta);
              break;
            }
          }
        result[bone][field] = v;
      }
    }
    return result;
  }
  // x/y 是画布位置；scale 是倍率；clip 是动画名；t 是时间（秒）。
  function draw(
    ctx,
    model,
    x,
    y,
    scale,
    angle = 0,
    clip = "Common_Idle",
    t = 0,
    eq = 0,
    hold = 0,
    loop = true,
  ) {
    let u = models[model],
      anim = u.animations[clip],
      at = anim ? (loop ? t % anim.duration : Math.min(t, anim.duration)) : 0,
      pose = sample(anim, at),
      vars = {
        "resource.equipmentindex": eq,
        "resource.equipmentindex2": 0,
        "resource.tilemode": 0,
        "memory.nowweaponindex": hold,
        "memory.armlbreaked": false,
        "memory.armrbreaked": false,
        "memory.headbreaked": false,
        "memory.leglbreaked": false,
        "memory.legrbreaked": false,
        "memory.close": false,
        "memory.ef_shm_unit.hp": 0,
        "self.shield": model === "RX_78_2" ? 1 : 0,
        "memory.legframe": Math.floor(t / (8 / 30)) % 4,
      };
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.imageSmoothingEnabled = false;
    for (const d of u.decals) {
      if (d.name.includes("Boost") || d.onlyOnNonPreview === "true") continue;
      let visible = true;
      try {
        visible = d.isVisible === undefined || expression(d.isVisible, vars);
      } catch {
        visible = false;
      }
      if (!visible) continue;
      let im = images[d.asset];
      if (!im) continue;
      let b = u.bones[d.basePositionFromLegEnd] || { x: 0, y: 0 },
        a = pose[d.basePositionFromLegEnd] || {},
        theta = ((angle - 90) * Math.PI) / 180,
        bx = val(b.x, vars) + (a.x || 0),
        by = val(b.y, vars) + (a.y || 0),
        px = Math.cos(theta) * by - Math.sin(theta) * bx,
        py = Math.sin(theta) * by + Math.cos(theta) * bx,
        facing = angle - 90 + val(b.endDirOffset, vars) + (a.dir || 0) + val(b.drawDirOffset, vars),
        r = ((facing + val(d.pivotOffset, vars)) * Math.PI) / 180,
        dx =
          val(d.xOffsetRelative, vars) +
          (model === "RX_77_2" && ["Head", "Head_Close"].includes(d.name) ? -0.5 : 0),
        dy = val(d.yOffsetRelative, vars);
      px += Math.cos(r) * dy - Math.sin(r) * dx + val(d.xOffsetAbsolute, vars);
      py +=
        Math.sin(r) * dy +
        Math.cos(r) * dx +
        val(d.yOffsetAbsolute, vars) -
        val(d.hOffset, vars) -
        (a.height || 0);
      let frames = val(d.total_frames, vars, 1),
        fw = val(d.frame_width, vars, Math.floor(im.width / frames)),
        fh = val(d.frame_height, vars, im.height),
        fr = 0;
      try {
        let fs = String(d.frame || "0")
          .replace(/self\.isMoving\(\)/gi, clip === "OnMovingWalk" ? "true" : "false")
          .replace(/self\.isReversing\(\)/gi, "false");
        fr = Math.max(0, Math.floor(expression(fs, vars)));
      } catch {}
      let cols = Math.floor(im.width / fw);
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(((facing + 90 + val(d.dirOffset, vars)) * Math.PI) / 180);
      ctx.scale(
        val(d.imageScale, vars, 1) * val(d.imageScaleX, vars, 1),
        val(d.imageScale, vars, 1) * val(d.imageScaleY, vars, 1),
      );
      ctx.globalAlpha = val(d.alpha, vars, 1);
      ctx.drawImage(
        im,
        (fr % cols) * fw,
        Math.floor(fr / cols) * fh,
        fw,
        fh,
        -(frames > 1 ? Math.floor(fw / 2) : fw / 2),
        -(frames > 1 ? Math.floor(fh / 2) : fh / 2),
        fw,
        fh,
      );
      ctx.restore();
    }
    ctx.restore();
  }
  async function load() {
    await Promise.all(
      Object.entries(ART.assets).map(
        ([key, src]) =>
          new Promise((resolve, reject) => {
            let image = new Image();
            image.onload = () => {
              images[key] = image;
              resolve();
            };
            image.onerror = () => reject(Error("素材加载失败"));
            image.src = src;
          }),
      ),
    );
  }
  return { draw, load, models, images };
})();
