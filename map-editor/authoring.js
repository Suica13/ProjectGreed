/* Portable editor authoring helpers; ZIP uses standard uncompressed entries. */
const MapAuthoring = (() => {
  function parseUnits(text, doc, catalog) {
    const result = [], occupied = new Set((doc.units || []).map(u => `${u.x},${u.y}`));
    for (const [index, raw] of text.split(/\r?\n/).entries()) {
      const line = raw.trim(); if (!line || line.startsWith('#')) continue;
      const parts = line.split(/[,，\t]/).map(s => s.trim());
      const fail = reason => { throw Error(`第${index + 1}行：${reason}`); };
      if (parts.length < 4 || parts.length > 5 || parts.some(s => !s)) fail('格式应为 单位,队伍,X,Y[,数量]');
      const matches = catalog.filter(u => u.id === parts[0] || u.name === parts[0]);
      if (matches.length !== 1) fail('单位不存在或名称重复，请使用精确单位 ID');
      const [team, x, y, count] = [...parts.slice(1,4), parts[4] || '1'].map(Number);
      if (![team,x,y,count].every(Number.isInteger) || team < 1 || team > doc.maxTeams || x < 0 || x >= doc.width || y < 0 || y >= doc.height || count < 1 || count > 2048) fail('队伍、坐标或数量超出范围');
      for (let n = 0; n < count; n++) {
        const offset = y * doc.width + x + n, px = offset % doc.width, py = Math.floor(offset / doc.width);
        if (py >= doc.height || occupied.has(`${px},${py}`)) fail('生成位置越界或与已有单位重叠');
        occupied.add(`${px},${py}`);
        result.push({unitId: matches[0].id, name: matches[0].name, team: team - 1, x: px, y: py});
      }
      if ((doc.units || []).length + result.length > 2048) fail('最多2048个预置单位');
    }
    if (!result.length) throw Error('请输入单位配置');
    return result;
  }
  function resourceFiles(doc) {
    const files = [], seen = new Map(), manifest = [];
    const add = (src, owner) => {
      if (typeof src !== 'string') throw Error('图片资源缺失');
      const match = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(src);
      if (!match) throw Error('资源尚未嵌入，请先通过导入图片加载资源');
      let path = seen.get(src);
      if (!path) {
        path = `resources/image-${files.length + 1}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
        files.push({name:path, data:Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))}); seen.set(src,path);
      }
      manifest.push({owner,path});
    };
    doc.tilesets.forEach(s => add(s.image, `tileset:${s.id}`));
    doc.layers.filter(l => l.type === 'image').forEach(l => add(l.image.src, `layer:${l.id}`));
    return {files, manifest};
  }
  function zip(entries) {
    const enc = new TextEncoder(), chunks = [], central = []; let offset = 0;
    function header(size) { const bytes = new Uint8Array(size); return [bytes,new DataView(bytes.buffer)]; }
    for (const entry of entries) {
      const name = enc.encode(entry.name), data = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
      let crc = 0xffffffff; for (const b of data) { crc ^= b; for (let j=0;j<8;j++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } crc = (crc ^ 0xffffffff) >>> 0;
      const [local,l] = header(30); l.setUint32(0,0x04034b50,true); l.setUint16(4,20,true); l.setUint16(6,0x800,true); l.setUint32(14,crc,true); l.setUint32(18,data.length,true); l.setUint32(22,data.length,true); l.setUint16(26,name.length,true);
      const [dir,d] = header(46); d.setUint32(0,0x02014b50,true); d.setUint16(4,20,true); d.setUint16(6,20,true); d.setUint16(8,0x800,true); d.setUint32(16,crc,true); d.setUint32(20,data.length,true); d.setUint32(24,data.length,true); d.setUint16(28,name.length,true); d.setUint32(42,offset,true);
      chunks.push(local,name,data); central.push(dir,name); offset += local.length + name.length + data.length;
    }
    const size = central.reduce((s,b)=>s+b.length,0), [end,e] = header(22);
    e.setUint32(0,0x06054b50,true); e.setUint16(8,entries.length,true); e.setUint16(10,entries.length,true); e.setUint32(12,size,true); e.setUint32(16,offset,true);
    return new Blob([...chunks,...central,end],{type:'application/zip'});
  }
  return {parseUnits,resourceFiles,zip};
})();
if (typeof module !== 'undefined') module.exports = MapAuthoring;
