"""Weapon-kit COST policy. Physical rifles are not automatically beam rifles."""
import json
import re
from pathlib import Path

PRICES = json.loads((Path(__file__).resolve().parents[1] / "assets/weapon-kit-costs.json").read_text(encoding="utf-8"))


def surcharge(key, weapon=None):
    weapon = weapon or {}
    ident = weapon.get("sourceName", key)
    if ident == "EF_GMRifle" or re.search(r"\d+mmMG", ident, re.I):
        return PRICES["machine_gun"]
    if re.search(r"Cannon", ident, re.I):
        return PRICES["cannon"]
    if weapon.get("type") != "shell" and (re.search(r"BeamRifle|(?:^|_)[SHL]?BR(?:_|$)", ident, re.I) or weapon.get("type") == "beam" and "Rifle" in ident and "Sniper" not in ident):
        return PRICES["beam_rifle"]
    if re.search(r"BeamGun|BeamSpray", ident, re.I):
        return PRICES["beam_gun"]
    if re.search(r"Rifle", ident, re.I):
        return 100  # Existing physical long/sniper-rifle policy, not changed here.
    if re.search(r"Bazooka|Missile|Launcher|(?:^|_)MS(?:_|$)|SMS", ident):
        return PRICES["bazooka"]
    return 0
