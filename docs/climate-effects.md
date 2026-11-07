# Climate visual assets and tuning

This is the first experimental environmental-effects layer. It is **cosmetic** and does not modify the authoritative sensor modifiers.

## Editable presets

Edit `client/climate-effects.json`:

- `transitionMs`: weather/time crossfade duration (milliseconds)
- `timeDarkness`: opacity for each of the eight time periods
- `precipitation`: particle count, speeds, stroke, opacity, line length and radius for each precipitation type
- `overlays`: tint and opacity for fog, clouds, storms and sand
- `surfaces`: per-round snow, wetness and dust accumulation / melting rates
- `lightning`: enabled flag, triggering weather, interval, flash duration and maximum brightness
- `assets`: optional replacement PNG/WebP textures for particles and ground covers

The default values work without any image assets. To replace a generated effect, place a PNG or WebP under `assets/` and set the corresponding `assets` entry, e.g. `"snow": "assets/weather/snow.png"`. `node build.cjs` embeds local images as data URIs for standalone HTML. Keep replacement files small: full-resolution image overlays increase the final HTML size.

Map authors can independently change weather weights, allowed weather, duration, allowed time phases, and duration using the existing `climate` map object. These settings are not coupled to the cosmetic presets.

## Limitations

Surface coverage follows tactical tiles and terrain-specific snow, wetness and dust multipliers, with explicit per-map opt-in and a room-level veto. It does not model individual rooftops. Flashing is disabled on space maps and should eventually respect a reduced-flashing accessibility option. No audio, thunder, footsteps or per-unit splashes are included yet.

Browser regression tests cover terrain coverage, grouped shadow opacity and room controls. Android device rendering still requires hardware validation.

## Terrain IDs

New editable terrain types: `road` (road), `shallow_water` (ground-classified shallow water), `deep_water` (sea), `residential` (built-up area). Existing `snow`, `desert` and `rock` remain as snowfield, sandy terrain and mountain. Legacy `water` remains supported. Tile categories and per-terrain cover multipliers live in `shared/map-document.js`.

New terrain metadata does not yet comprehensively update unit movement and terrain combat modifiers; those require a separate compatibility pass before new terrain IDs are used in published maps.
