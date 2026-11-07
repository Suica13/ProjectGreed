"use strict";
// Actual Chromium 80 via CDP. Modern Playwright's injected helpers themselves require newer JS.
const fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const WebSocket = require("ws");
const root = path.resolve(__dirname, ".."),
  content = path.join(root, "build/app-client/content");
const exe =
  process.env.PROJECTGREED_CHROMIUM80 ||
  path.join(root, "build/toolchains/chromium80/chrome-win/chrome.exe");
const evidence = fs.mkdtempSync(path.join(root, "tmp/chromium80-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let child, socket, server, gameServer;
const errors = [],
  pending = new Map();
let sequence = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails)
    throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function wait(expression, timeout = 60000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      if (await evaluate(expression)) return;
    } catch (e) {
      last = e;
    }
    await sleep(100);
  }
  throw Error("Timed out: " + expression + " " + (last || ""));
}
const click = (selector) =>
  evaluate(
    `(function(){var b=document.querySelector(${JSON.stringify(selector)});if(!b||b.disabled)throw Error('Unavailable: '+${JSON.stringify(selector)});b.click();})()`,
  );
async function screenshot(name) {
  await sleep(500);
  const details = await evaluate(
    `(function(){var selectors=['#productionList .production-unit','#productionList .production-unit-info','#productionList .production-unit-portrait','#formationMain .formation-title','#customPilotList .custom-pilot-card','#customPilotList .pilot-list-skills'];return selectors.map(function(selector){var el=document.querySelector(selector);if(!el)return {selector:selector};var s=getComputedStyle(el);return {selector:selector,rect:el.getBoundingClientRect().toJSON(),display:s.display,columns:s.gridTemplateColumns,rows:s.gridTemplateRows,gridArea:s.gridArea,flex:s.flexDirection,fontSize:s.fontSize,position:s.position,children:Array.from(el.children).map(function(c){return {tag:c.tagName,className:c.className,rect:c.getBoundingClientRect().toJSON(),grid:getComputedStyle(c).gridArea};})};});})()`,
  );
  fs.writeFileSync(path.join(evidence, name + ".json"), JSON.stringify(details, null, 2));
  const result = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(evidence, name + ".png"), Buffer.from(result.data, "base64"));
}
(async () => {
  try {
    server = http.createServer((req, res) => {
      const file = path.resolve(content, "." + new URL(req.url, "http://local").pathname);
      if (!file.startsWith(content + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const mime = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".ogg": "audio/ogg",
        ".mp3": "audio/mpeg",
      };
      res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
      const stream = fs.createReadStream(file);
      stream.on("error", () => {
        res.writeHead(404);
        res.end();
      });
      stream.pipe(res);
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${server.address().port}`;
    child = spawn(
      exe,
      [
        "--headless",
        "--disable-gpu",
        "--remote-debugging-port=0",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "--disable-default-apps",
        "--no-proxy-server",
        "--user-data-dir=" + path.join(evidence, "browser"),
        "about:blank",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    const portFile = path.join(evidence, "browser/DevToolsActivePort");
    for (let i = 0; i < 150 && !fs.existsSync(portFile); i++) {
      if (child.exitCode !== null) throw Error("Chromium exited");
      await sleep(100);
    }
    const port = fs.readFileSync(portFile, "utf8").split("\n")[0];
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    assert.match(version.Browser, /\/80\./);
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(targets.find((t) => t.type === "page").webSocketDebuggerUrl);
    await once(socket, "open");
    socket.on("message", (text) => {
      const event = JSON.parse(text);
      if (event.id) {
        const p = pending.get(event.id);
        if (p) {
          pending.delete(event.id);
          event.error ? p.reject(Error(JSON.stringify(event.error))) : p.resolve(event.result);
        }
      } else if (event.method === "Runtime.exceptionThrown")
        errors.push(
          event.params.exceptionDetails.exception?.description ||
            event.params.exceptionDetails.text,
        );
    });
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await send("Emulation.setUserAgentOverride", {
      userAgent:
        "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Chrome/80.0.3987.0 Mobile Safari/537.36",
    });
    await send("Page.addScriptToEvaluateOnNewDocument", {
      source: `(function(){var disk=window.localStorage;var state=JSON.parse(disk.getItem('test-native-profile')||'{"ok":true,"revision":0,"values":{}}');window.nativeScenes=[];window.ProjectGreedAndroid={read:function(){return JSON.stringify(state);},commit:function(text){var next=JSON.parse(text);if(next.revision!==state.revision)return '{"ok":false,"error":"stale"}';state={ok:true,revision:state.revision+1,values:next.values};disk.setItem('test-native-profile',JSON.stringify(state));return JSON.stringify({ok:true,revision:state.revision});},sceneChanged:function(scene,ready){nativeScenes.push({scene:scene,ready:ready});},chooseStorageFolder:function(){},compatibilityResult:function(text){window.compatibilityReport=JSON.parse(text);},exportFile:function(){},exit:function(){}};})();`,
    });
    await send("Page.navigate", { url: url + "/compatibility.html" });
    await wait("Array.isArray(window.compatibilityReport)");
    assert.deepEqual(await evaluate("compatibilityReport"), []);
    await send("Page.navigate", { url: url + "/client.html" });
    await wait("typeof assetsReady !== 'undefined' && assetsReady");
    await evaluate("I18n.setLanguage('zh')");
    assert.equal(await evaluate("AppCompat.legacyLayout"), true);
    assert.ok(
      await evaluate(
        `(function(){var value={map:new Map([['x',7]]),set:new Set([2]),bytes:new Uint8Array([1,2]),date:new Date(42),nan:NaN,missing:undefined};value.self=value;var copy=structuredClone(value);return copy!==value&&copy.self===copy&&copy.map.get('x')===7&&copy.set.has(2)&&copy.bytes[1]===2&&copy.date.getTime()===42&&Number.isNaN(copy.nan)&&Object.hasOwn(copy,'missing');})()`,
      ),
    );
    const relational = require("../tools/build-app-legacy.cjs").transformCss(
      "#compatProbe{color:rgb(1,2,3)}#compatProbe:has(.probe-child:not([hidden])){color:rgb(11,22,33)}",
    );
    await evaluate(
      `(function(){var style=document.createElement('style');style.id='compatProbeStyle';style.textContent=${JSON.stringify(relational)};document.head.appendChild(style);var el=document.createElement('div');el.id='compatProbe';el.innerHTML='<span class="probe-child">x</span>';document.body.appendChild(el);})()`,
    );
    await wait(
      "getComputedStyle(document.getElementById('compatProbe')).color==='rgb(11, 22, 33)'",
    );
    await evaluate("document.querySelector('#compatProbe .probe-child').hidden=true");
    await wait("getComputedStyle(document.getElementById('compatProbe')).color==='rgb(1, 2, 3)'");
    await evaluate(
      "document.getElementById('compatProbe').remove();document.getElementById('compatProbeStyle').remove()",
    );
    await screenshot("menu");
    await evaluate("MenuShell.go('pilots')");
    await click("#createCustomPilot");
    await click("#createPilotConfirm");
    assert.equal(await evaluate("ProfileSave.exportData().pilots.PMC.pilots.length"), 1);
    await screenshot("pilots");
    await evaluate(
      "MenuShell.go('production');var input=byId('productionSearch');input.value='Type61';input.dispatchEvent(new Event('input',{bubbles:true}));",
    );
    await wait("document.querySelectorAll('#productionList .production-unit').length>0");
    await click('#productionList [data-unit-id="Type61"] .production-unit-portrait');
    await click("#produceUnit");
    await click("#buyProductionKit");
    await wait(
      "(function(){var p=document.querySelector('#productionList .production-unit-portrait').getBoundingClientRect(),i=document.querySelector('#productionList .production-unit-info').getBoundingClientRect();return i.left>p.left&&Math.abs(i.top-p.top)<4;})()",
    );
    const wallet = await evaluate("Economy.snapshot()");
    assert.equal(wallet.inventory.Type61, 1);
    assert.equal(wallet.kits.Type61__standard, 2);
    await screenshot("production");
    await evaluate("MenuShell.go('formation')");
    await screenshot("formation");
    await send("Page.reload");
    await wait("typeof assetsReady !== 'undefined' && assetsReady");
    assert.deepEqual(await evaluate("Economy.snapshot()"), wallet);
    assert.equal(await evaluate("ProfileSave.exportData().pilots.PMC.pilots.length"), 1);
    gameServer = require("../server.js").createServer({ host: "127.0.0.1", port: 0 });
    const address = await gameServer.listen();
    await evaluate(
      `Net.serverURL=${JSON.stringify("ws://127.0.0.1:") + "+" + address.port + "+" + JSON.stringify("/ws")};Net.room='CHROME80';Net.connect('create',true);`,
    );
    await wait("Net.active && !Net.local && Net.snapshot && Net.snapshot.members.length===1");
    await evaluate("Net.leave()");
    await evaluate(
      `(async function(){await SpriteRenderer.load();Net.leave();TurnFlow.reset();var e={unitId:'Type61',kitId:'standard'};game=Rules.create(false,1,[[e],[e]],false,{costLimit:99999,unitCostLimit:10000});game.tiles.forEach(function(row){row.fill('plain');});game.units.forEach(function(u,i){u.x=10+i*2;u.y=10;});game.fogMode='disabled';selected=game.units[0].id;pending=battleView=moving=null;mode='select';phase='idle';setPageView('game');MapCamera.focus(11,10,{preserveZoom:true});update();drawMap(performance.now());})()`,
    );
    await screenshot("battle-portrait");
    assert.equal(
      await evaluate(
        "(function(){Rules.move(game,game.units[0],11,10);return game.units[0].x;})()",
      ),
      11,
    );
    assert.ok(
      await evaluate("Rules.firePlan(game,game.units[0],game.units[1]).weapons.length > 0"),
    );
    await send("Emulation.setDeviceMetricsOverride", {
      width: 844,
      height: 390,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await wait("document.documentElement.classList.contains('phone-landscape')");
    await sleep(500);
    await screenshot("battle-landscape");
    const geometry = await evaluate(
      "(function(){var b=document.body.getBoundingClientRect(),v=visualViewport;return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:v.width,height:v.height,x:v.offsetLeft,y:v.offsetTop};})()",
    );
    assert.ok(
      geometry.left >= geometry.x - 3 &&
        geometry.right <= geometry.x + geometry.width + 3 &&
        geometry.top >= geometry.y - 3 &&
        geometry.bottom <= geometry.y + geometry.height + 3,
      JSON.stringify(geometry),
    );
    assert.deepEqual(errors, []);
    fs.writeFileSync(
      path.join(evidence, "result.json"),
      JSON.stringify(
        {
          passed: true,
          browser: version.Browser,
          errors,
          checks: [
            "capability probe",
            "cyclic and typed-data clone",
            "dynamic relational selector updates",
            "pilot recruitment",
            "production and kits",
            "profile restart",
            "existing server WebSocket join",
            "movement and fire plan",
            "portrait and landscape battle",
          ],
        },
        null,
        2,
      ),
    );
    console.log("PASS actual Chromium 80: " + evidence);
  } catch (error) {
    fs.writeFileSync(
      path.join(evidence, "result.json"),
      JSON.stringify({ passed: false, error: String(error.stack), errors }, null, 2),
    );
    console.error(error);
    console.error("Evidence: " + evidence);
    process.exitCode = 1;
  } finally {
    if (socket) socket.close();
    if (child && child.exitCode === null) child.kill();
    if (gameServer) await gameServer.close();
    if (server) await new Promise((r) => server.close(r));
  }
})();
