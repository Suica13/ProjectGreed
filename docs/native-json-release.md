# Native JSON release policy

Windows and Android apps are the recommended player launchers. HTML file launch is retained for development and legacy recovery only. Gameplay remains JavaScript.

## Build
Windows: npm run release:windows
Android: npm run release:android

## Storage
Both native apps already use a ProjectGreed-app-store v1 JSON envelope for internal snapshots. Windows stores profile.json and profile.json.bak; Android stores profile.json and profile.previous.json. Native snapshots are not the same as portable personal-profile exports.

## Migration from HTML
1. Open the original HTML in the same browser/profile and file context that can read the save.
2. Use Settings > Export cross-platform JSON profile. Preserve a backup copy.
3. Open the native app and use Settings > Import cross-platform JSON profile.
4. Verify pilots, formations, economy and technology before deleting any legacy data.
5. Do not overwrite native internal profile.json with a portable profile export. Historical battle backups are not included in portable personal profiles.

## Safety
Never delete unrelated localStorage keys automatically. A browser-localStorage quota error identifies the legacy browser backend, not a native-file failure. Native bridge errors must not fall back to browser storage. Native snapshots currently have a 64 MiB limit.

## Release gate
Run npm test, npm run app:test:storage, native smoke tests, and real-device Windows/Android import-export and recovery checks before publishing.