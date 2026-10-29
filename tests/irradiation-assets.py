"""Verify optimized native middle frames preserve the original texture and alpha."""
import importlib.util
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
spec = importlib.util.spec_from_file_location('beam_import', 'tools/import-irradiation-assets.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

with tempfile.TemporaryDirectory() as temporary:
    for color in ('Pink', 'Blue', 'Yellow'):
        source = module.MAIN / f'Resource/Image/Fx/Weapon/Beam/HighMegaCannon/Image/HighMegaCannon_1_Mid_{color}.png'
        plain = Path(temporary) / f'{color}.png'
        module.resize(source, plain, 28)
        width, height, original, palette = module.decode(plain.read_bytes())
        actual_width, actual_height, pixels, actual_palette = module.decode(
            (module.ASSETS / f'effects/textures/Irradiation_Mid_{color}.png').read_bytes())
        assert (actual_width, actual_height) == (width, height) == (1960, 84)
        assert actual_palette == palette
        assert pixels == original, color + ": native middle pixels must remain unmodified"
        alpha = next(data for kind, data in palette if kind == b'tRNS')
        assert any(alpha[index] == 0 for index in pixels if index < len(alpha))
        assert any(alpha[index] > 0 for index in pixels if index < len(alpha))
        print(f'{color}: all 28 original frames and native transparency preserved')
