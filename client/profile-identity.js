/* A personal save owns its server reward identity. Never publish its secret in room snapshots. */
const ProfileIdentity = (() => {
  const key = "projectgreed.profile-identity.v1";
  function create() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return {
      id:
        typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : [...crypto.getRandomValues(new Uint8Array(16))]
              .map((value) => value.toString(16).padStart(2, "0"))
              .join(""),
      secret: [...bytes].map((value) => value.toString(16).padStart(2, "0")).join(""),
    };
  }
  function validate(value) {
    if (!value || !/^[a-zA-Z0-9_-]{16,80}$/.test(value.id) || !/^[a-f0-9]{64}$/.test(value.secret))
      throw Error("存档标识无效");
    return { id: value.id, secret: value.secret };
  }
  function snapshot() {
    const raw = localStorage.getItem(key);
    if (raw) return validate(JSON.parse(raw));
    const identity = create();
    localStorage.setItem(key, JSON.stringify(identity));
    return identity;
  }
  return { key, create, validate, snapshot };
})();
