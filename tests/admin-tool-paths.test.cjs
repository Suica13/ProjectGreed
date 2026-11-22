const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { createServer } = require("../server");
test("admin tool pages are served under admin without exposing developer editing API", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1" });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  for (const name of ["map-editor", "unit-editor", "task-tree-editor", "save-editor"]) {
    assert(fs.existsSync("admin/" + name + ".html"));
    assert.equal(fs.existsSync("public/" + name + ".html"), false);
    assert.equal(
      (await fetch(base + "/admin/" + name + ".html", { method: "HEAD" })).status,
      200,
      name,
    );
    assert.equal((await fetch(base + "/" + name + ".html")).status, 404, name);
  }
  assert.equal((await fetch(base + "/admin/")).status, 200);
  assert.equal((await fetch(base + "/admin/developer.html")).status, 404);
  assert.equal((await fetch(base + "/api/editor/session")).status, 404);
  assert.equal((await fetch(base + "/admin/../project.json")).status, 404);
});
