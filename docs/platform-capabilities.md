# Platform Capability Lanes

Glimpse stays on one product codebase and exposes Apple, Android, and baseline PWA behavior through capability lanes. Avoid long-lived `apple/*` and `android/*` feature branches for product logic; those branches drift quickly and make privacy, retry, and state bugs harder to find.

## Contract

`src/platform/capabilities.ts` is the app-level contract. It combines:

- coarse static platform signals from `src/lib/platformDetect.ts`
- baseline PWA APIs from `src/pwa/capabilities.ts`
- Apple-only enhancement gates from `src/apple/availability.ts`
- Android-only enhancement gates from `src/android/availability.ts`
- optional native wrapper presence, currently detected without adding Capacitor as a dependency

The snapshot is deliberately privacy-safe: it exposes booleans and small enums, not raw user agents, IP-derived location, account IDs, DIDs, notification tokens, or device identifiers.

## UI Ownership

`PlatformCapabilityBridge` owns document body attributes:

- `data-platform="apple|android|web"`
- `data-standalone="true|false"`
- `data-native-bridge="capacitor|web"`

Platform feature bridges should not set those attributes themselves. This keeps styling, state, and feature detection from diverging.

## Native Wrapper Path

The current PWA stack remains the right baseline. If the app needs native-only APIs or App Store distribution, add Capacitor behind this capability contract:

1. Add Capacitor dependencies and native projects in one short-lived feature branch.
2. Keep web behavior as the source of truth.
3. Put native-only calls behind small adapters keyed by `nativeBridge.kind`.
4. Never persist capability detection; re-detect on launch and on meaningful lifecycle events.
5. Keep Apple and Android differences in adapters, CSS capability attributes, and bridge modules instead of product forks.

## Branch Safety

Use short-lived branches for implementation work, not permanent platform forks. Release Apple and Android builds from the same commit whenever possible, with platform differences controlled by capability gates and build configuration. If a true native-only change is unavoidable, isolate it in the native project directories and keep shared app behavior untouched.
