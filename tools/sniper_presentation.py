"""Import the native lock marker; frame selection is controlled by tactical charge state."""
import shutil
from mod_source import ROOT, ASSETS


def attach(effects):
    source = ROOT / "Resource/Image/Fx/Weapon/Sp/Image/LockTarget_1.png"
    dest = ASSETS / "effects/textures/LockTarget_1.png"
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists() or dest.read_bytes() != source.read_bytes():
        shutil.copyfile(source, dest)
    effects["SniperLock"] = dict(texture="textures/LockTarget_1.png", frames=20,
        startFrame=0, endFrame=19, fps=10, scaleFrom=.5, scaleTo=.5,
        alpha=1, rotation=0, offset={"x":0,"y":0}, drift=0, sounds=[],
        source="Weapon/Template/Shoot_Sniper.ini: decal_SniperMarker")
