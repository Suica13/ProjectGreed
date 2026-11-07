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

The current surface overlay is screen-space, not per-tile material coverage. It is a visual prototype, not the final snow-on-rooftops implementation. Flashing is disabled on space maps and should eventually respect a reduced-flashing accessibility option. No audio, thunder, footsteps or per-unit splashes are included yet.

The current build has not been validated in a live browser/Android environment; test the standalone HTML and large battles before release.
