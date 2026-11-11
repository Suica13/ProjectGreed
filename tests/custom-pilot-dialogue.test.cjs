const test = require("node:test"), assert = require("node:assert/strict");
const P = require("../shared/pilots"), D = require("../client/battle-dialogue"), G = require("../shared/rules");
test("dialogue survives profile normalization, fleet validation and JSON round trips without changing stats", () => {
  const base = P.createCustom("custom-dialogue", "Dialogue"),
    dialogue = { attack: [" First line ", "Second line"], kill: ["<b>literal text</b>"] };
  const pilot = P.custom({ ...base, dialogue });
  assert.deepEqual(pilot.dialogue.attack, ["First line", "Second line"]);
  assert.deepEqual(P.importDialogue(JSON.parse(JSON.stringify(P.exportDialogue(pilot.dialogue)))), pilot.dialogue);
  const { dialogue: _, ...rest } = pilot;
  assert.deepEqual(rest, base);
  assert.deepEqual(G.validateFormation([{ unitId: "Type61", kitId: "standard", customPilot: pilot }], Infinity, 18)[0].customPilot.dialogue, pilot.dialogue);
  assert.deepEqual(G.makeUnit({ unitId:"Type61", kitId:"standard", customPilot:pilot },0,"custom-unit",{x:0,y:0}).pilot.dialogue,pilot.dialogue);
  dialogue.attack[0] = "changed";
  assert.equal(pilot.dialogue.attack[0], "First line");
  assert.equal(P.custom(base).dialogue, undefined);
  assert.deepEqual(P.normalizeDialogue({ attack: ["", "  "] }), {});
});
test("imports reject unknown events, wrong schemas, control characters and oversized text", () => {
  for (const value of [[], {unknown:["x"]}, {attack:"x"}, {attack:[12]}, {attack:["x\ny"]}, {attack:["x".repeat(121)]}, {attack:Array(13).fill("x")}])
    assert.throws(() => P.normalizeDialogue(value));
  assert.throws(() => P.normalizeDialogue(Object.fromEntries(P.dialogueEvents.map(([id]) => [id,Array(12).fill("x".repeat(120))]))));
  assert.throws(() => P.importDialogue({ format: "projectgreed.pilot-dialogue", version: 2, dialogue: {} }));
  assert.throws(() => P.importDialogue({ id:"custom-hack", level:8 }));
  assert.throws(() => P.normalizeDialogue(JSON.parse('{"__proto__":["x"]}')));
});
test("all events choose only the pilot's custom pool, vary by sequence and remain deterministic", () => {
  const pilot = P.custom({ ...P.createCustom("custom-lines", "Lines"), personality:"custom",
    dialogue: Object.fromEntries(P.dialogueEvents.map(([id]) => [id,[id+" A",id+" B"]])),
  }), speaker = { id:"speaker", pilot }, target = {id:"target"};
  for (const [event] of P.dialogueEvents) {
    const generate = sequence => ["board","launch","preload"].includes(event)
      ? D.transport({event,speaker,target,sequence})
      : event.startsWith("passenger") ? D.transportReply({event:event === "passengerLaunch" ? "launch" : "board",speaker,target,sequence})
      : D.generate({event,speaker,target,sequence});
    const samples = Array.from({length:2000},(_,i)=>generate(i)).filter(Boolean);
    assert(samples.length>0,event);
    assert.deepEqual(new Set(samples.map(s=>s.text)),new Set(pilot.dialogue[event]),event);
    assert(samples.every(s=>s.customText === true));
    assert.deepEqual(generate(samples[0].sequence),samples[0]);
  }
  const fallback = {...speaker,pilot:P.createCustom("custom-empty","Empty")};
  const defaultLine = Array.from({length:100},(_,sequence)=>D.generate({event:"kill",speaker:fallback,sequence})).find(Boolean);
  assert(defaultLine && !defaultLine.customText);
  const disabled = {...speaker,pilot:{...pilot,personality:"calm"}};
  assert(Array.from({length:100},(_,sequence)=>D.generate({event:"kill",speaker:disabled,sequence})).filter(Boolean).every(line=>!line.customText));
});
