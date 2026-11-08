/* Lossless storage encoding. Runtime callers still work with ordinary objects. */
"use strict";
const SaveCodec = (() => {
  function packClaims(store) {
    const groups = new Map();
    for (const [id, match] of Object.entries(store.claimed || {})) {
      if (!groups.has(match)) groups.set(match, []);
      groups.get(match).push(id);
    }
    const { claimed, ...rest } = store;
    return {
      ...rest,
      claimedPacked: [...groups].map(([match, ids]) => {
        let prefix = ids[0];
        for (const id of ids) {
          let n = 0;
          while (n < prefix.length && prefix[n] === id[n]) n++;
          prefix = prefix.slice(0, n);
        }
        return [match, prefix, ids.map((id) => id.slice(prefix.length))];
      }),
    };
  }
  function unpackClaims(store) {
    if (!store || !Array.isArray(store.claimedPacked) || store.claimed !== undefined)
      throw Error("奖励记录压缩格式无效");
    const claimed = {};
    for (const group of store.claimedPacked) {
      if (!Array.isArray(group) || group.length !== 3) throw Error("奖励记录压缩格式无效");
      const [match, prefix, suffixes] = group;
      if (
        typeof match !== "string" ||
        match.length > 200 ||
        typeof prefix !== "string" ||
        prefix.length > 200 ||
        !Array.isArray(suffixes)
      )
        throw Error("奖励记录压缩格式无效");
      for (const suffix of suffixes) {
        if (typeof suffix !== "string" || prefix.length + suffix.length > 200)
          throw Error("奖励记录压缩格式无效");
        const id = prefix + suffix;
        if (!id || Object.hasOwn(claimed, id)) throw Error("奖励记录重复或无效");
        Object.defineProperty(claimed, id, {
          value: match,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
    }
    const { claimedPacked, ...rest } = store;
    return { ...rest, claimed };
  }
  function decodeRecord(value) {
    return value && Object.hasOwn(value, "claimedPacked") ? unpackClaims(value) : value;
  }
  function stringify(value) {
    const raw = JSON.stringify(value);
    if (!value?.claimed || !Object.keys(value.claimed).length) return raw;
    const packed = JSON.stringify(packClaims(value));
    return packed.length < raw.length ? packed : raw;
  }
  const parse = (text) => decodeRecord(JSON.parse(text));
  return { packClaims, unpackClaims, decodeRecord, stringify, parse };
})();
if (typeof module !== "undefined") module.exports = SaveCodec;
