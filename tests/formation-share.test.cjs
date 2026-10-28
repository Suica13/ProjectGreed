const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Rules=require('../shared/rules.js');
test('share export and legacy import strip pilot records and assignments',()=>{
 const source=fs.readFileSync('client/formation.js','utf8');
 const context=vm.createContext({Rules,TextEncoder,TextDecoder,btoa,atob});
 vm.runInContext(source.slice(source.indexOf('  const sharePrefix'),source.indexOf('  function uniqueSquadName'))+'\nglobalThis.api={encodeShare,decodeShare};',context);
 const entry={unitId:'Type61',kitId:'standard',customName:'Tank',customPilot:Rules.pilots.createCustom('custom-private-pilot','Secret',null,'PMC')};
 const encoded=context.api.encodeShare('share',[entry]);
 const payload=JSON.parse(Buffer.from(encoded.slice(5),'base64url').toString());
 assert.deepEqual(payload.units,[{unitId:'Type61',kitId:'standard',customName:'Tank'}]);
 payload.units[0].customPilot=entry.customPilot;payload.units[0].pilotId='custom-private-pilot';
 const imported=context.api.decodeShare('PGF1.'+Buffer.from(JSON.stringify(payload)).toString('base64url'));
 assert.equal(imported.units[0].customPilot,undefined);assert.equal(imported.units[0].pilotId,undefined);
});
