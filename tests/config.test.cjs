const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { loadConfig, createServer } = require("../server.js");
test("JSON port config, overrides and invalid values", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slg-cfg-")),
    configPath = path.join(dir, "cfg.json");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const read = (args = [], env = {}) => loadConfig({ configPath, args, env });
  fs.writeFileSync(configPath, JSON.stringify({ port: 1313 }));
  assert.equal(read().port, 1313);
  assert.equal(read([], { PORT: "9001" }).port, 9001);
  assert.equal(read(["--port", "9002"], { PORT: "9001" }).port, 9002);
  assert.throws(() => read(["--port"]), /端口/);
  for (const port of [0, 65536, 1.5, "1313", null]) {
    fs.writeFileSync(configPath, JSON.stringify({ port }));
    assert.throws(() => read(), /port/);
  }
  fs.writeFileSync(configPath, "{broken");
  assert.throws(() => read(), /cfg.json/);
  fs.unlinkSync(configPath);
  assert.throws(() => read(), /cfg.json/);
  const probe = createServer({ port: 0, host: "127.0.0.1" });
  const address = await probe.listen();
  await probe.close();
  fs.writeFileSync(configPath, JSON.stringify({ port: address.port }));
  const app = createServer({ ...read(), host: "127.0.0.1" });
  await app.listen();
  try {
    const response = await fetch("http://127.0.0.1:" + address.port + "/health");
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.project, "ProjectGreed");
    assert.equal(health.version, "V06");
  } finally {
    await app.close();
  }
});
