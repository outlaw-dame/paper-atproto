# Paper-AtProto Platform Architecture Assessment

**Assessment Date**: May 2026  
**Verdict**: Paper-atproto has a **strong 70–75% alignment** with native-platform design goals. The remaining 25–30% is mostly design-system enforcement, platform-specific UX policy, and icon registry discipline.

---

## Executive Summary

Paper-atproto has an excellent foundation:
- ✅ **Platform detection**: `PlatformCapabilitySnapshot` with Android/Apple/Web families
- ✅ **Design tokens**: Semantic + component tokens in `src/design/`
- ✅ **Enhancement bridges**: `AppleEnhancementBridge`, `AndroidEnhancementBridge`
- ✅ **Motion library**: Framer Motion integrated
- ✅ **PWA infrastructure**: Service worker, offline support, badging

The gaps are in **governance and layering**:
- ❌ No AppKit primitives layer (feature pages use raw components + direct Lucide imports)
- ❌ No icon registry (no semantic icon → iOS/Material mapping)
- ❌ No PlatformUX adapter (capability snapshot not converted to UI decisions)
- ❌ No strict design-system enforcement (ESLint, import restrictions)
- ⚠️ Appearance plumbing incomplete (platform detection present, but not fully wired to dark/light/dim)
- ⚠️ PWA manifest incomplete (missing screenshots, shortcuts, share-target)

**Recommendation**: Do NOT rewrite. Implement the governance layer on top of existing tokens/bridges.

---

## What's Already Right

### 1. Platform Detection is Correctly Designed

**Location**: `src/platform/capabilities.ts`, `src/lib/platformDetect.ts`

```typescript
export type PlatformFamily = 'apple' | 'android' | 'web';
export type PlatformVisualLanguage = 'apple' | 'material' | 'web';
```

**Why this is correct**:
- Android → Material visual language (detected early)
- Everything else defaults to Apple-like
- Explicit family enum prevents string accidents
- Coarse signals only (no UA strings or identifiers in snapshot)

**Current state**: Ready to use. No changes needed.

---

### 2. Design Tokens Are Layered Correctly

**Foundation Layer** (`src/design/foundation.ts`):
- Spacing, radii, strokes, shadows, blur, type scales
- Color primitives: `neutralLight`, `neutralDark`, `discovery`, `discussion`, `intel`

**Semantic Layer** (`src/design/semantic.ts`):
- `neutral`, `discoveryMode`, `discussionMode`, `intelMode`
- These differ by mode, not hard-coded

**Component Layer** (`src/design/components.ts`):
- `searchHeroField`, `storyProgress`, `promptHero`, `interpolator`
- Component-specific mappings

**Why this is correct**: Three-tier abstraction prevents color/spacing accidents.

**Current state**: Excellent. Use this pattern for new components.

---

### 3. Platform Bridges Are In Place

**Location**: 
- `src/components/PlatformCapabilityBridge.tsx`
- `src/components/AppleEnhancementBridge.tsx`
- `src/components/AndroidEnhancementBridge.tsx`
- `src/components/PlatformBanners.tsx`

**Why this is correct**:
- Separates platform capability detection from UI rendering
- Bridges initialize outside React render tree
- Each platform gets its own enhancement handler

**Current state**: Functional. Needs to be extended with PlatformUX adapter.

---

### 4. CSS Handles Platform Differentiation

**Location**: `src/styles/globals.css`

Already includes:
- Platform-aware button interactions: `[data-platform="android"]` selector for ripple effect
- Safe area helpers
- Scrollbar hiding on mobile
- Viewport fit handling
- Color-scheme support

**Example**:
```css
[data-platform="android"] button::after {
  /* Material Design 3 ripple */
  background: radial-gradient(circle at 50% 50%, currentColor 0%, transparent 70%);
}
```

**Current state**: Excellent foundation. Missing: iPad/macOS specific rules.

---

### 5. Motion Library is Integrated

**Location**: `src/design/motion.ts`, Framer Motion usage throughout

**Current state**: Ready. App has `motion.ts` for shared transition configurations.

---

## Critical Gaps

### Gap 1: No Icon Registry (HIGH PRIORITY)

**Current state**: Components import `lucide-react` directly.

**Problem**:
- No semantic mapping to iOS/Material variants
- Lucide is tree-shakable but neutral (not iOS-native style)
- No restriction preventing random icon choices

**Solution**: Create `src/design/icons/AppIcon.tsx`

```typescript
// src/design/icons/index.ts
export type SemanticIconName = 
  | 'home' | 'explore' | 'search' | 'compose' 
  | 'messages' | 'notifications' | 'profile' | 'settings'
  | 'back' | 'close' | 'menu' | 'share' | 'like' | 'reply';

export interface AppIconProps {
  name: SemanticIconName;
  variant?: 'filled' | 'outline'; // iOS: filled/outline; Material: filled/outline
  size?: number;
  color?: string;
  className?: string;
}

export function AppIcon({ name, variant = 'filled', size = 24, color }: AppIconProps) {
  const platform = usePlatformCapabilities();
  
  if (platform.ui.visualLanguage === 'material') {
    return <MaterialIcon name={name} variant={variant} size={size} color={color} />;
  }
  
  // iOS default
  return <LucideIcon name={name} variant={variant} size={size} color={color} />;
}
```

**Add ESLint restriction immediately**:
```json
{
  "rules": {
    "no-restricted-imports": [
      "error",
      {
        "paths": [
          {
            "name": "lucide-react",
            "message": "Use src/design/icons/AppIcon instead"
          }
        ]
      }
    ]
  }
}
```

---

### Gap 2: No PlatformUX Adapter (HIGH PRIORITY)

**Current state**: `PlatformCapabilitySnapshot` exists but is not converted to UI decisions.

**Problem**: Features must check raw capabilities everywhere:
```typescript
// DON'T do this in feature code:
if (capabilities.pwa.share) { /* render share button */ }
if (capabilities.android.beforeInstallPrompt) { /* handle Android install */ }
```

**Solution**: Create `src/platform/usePlatformUX.ts`

```typescript
export type PlatformUX = {
  theme: 'ios' | 'material';
  visualLanguage: 'apple' | 'material';
  navigationPattern: 'ios-tabs' | 'ios-sidebar' | 'material-tabs' | 'material-rail';
  composePattern: 'ios-toolbar-sheet' | 'material-fab';
  installPattern: 'ios-share-sheet-instructions' | 'android-beforeinstallprompt' | 'desktop-browser';
  motionPreset: 'ios-spring' | 'material-emphasized' | 'reduced';
  hapticsPolicy: 'none' | 'vibration-api-light';
};

export function usePlatformUX(): PlatformUX {
  const capabilities = usePlatformCapabilities();
  const appearance = useAppearance();
  
  return {
    theme: capabilities.ui.visualLanguage === 'material' ? 'material' : 'ios',
    visualLanguage: capabilities.ui.visualLanguage,
    navigationPattern: capabilities.staticInfo.isTablet ? 'ios-sidebar' : 'ios-tabs',
    // ...
  };
}
```

---

### Gap 3: No AppKit Primitives (MEDIUM PRIORITY)

**Current state**: Features use raw Konsta components (not installed yet) or Tailwind directly.

**Problem**: Platform inconsistency spreads. Example:
```tsx
// Feature A: uses Tailwind for button
<button className="px-4 py-2 bg-blue-500 rounded">Action</button>

// Feature B: uses different spacing/color
<button className="px-3 py-1 bg-indigo-500 rounded-lg">Action</button>
```

**Solution**: Create `src/components/app-kit/` layer

```typescript
// src/components/app-kit/AppButton.tsx
export interface AppButtonProps {
  variant: 'primary' | 'secondary' | 'tertiary' | 'destructive';
  size: 'sm' | 'md' | 'lg';
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export function AppButton({ variant, size, ...props }: AppButtonProps) {
  const platformUX = usePlatformUX();
  
  const styles = {
    // iOS gets spring, Material gets emphasized
    transition: platformUX.motionPreset === 'ios-spring'
      ? { type: 'spring', stiffness: 420, damping: 38 }
      : { duration: 0.24, ease: [0.2, 0, 0, 1] },
  };
  
  return <motion.button style={styles} className={getButtonClasses(variant, size)}>
    {props.children}
  </motion.button>;
}
```

Primitives to create:
- `AppButton` (primary, secondary, tertiary, destructive)
- `AppNavBar` (with large-title collapse on iOS)
- `AppTabBar` (iOS bottom tabs vs Material bottom nav)
- `AppList` / `AppCell` (grouped list pattern)
- `AppSheet` (iOS sheet vs Material bottom sheet)
- `AppSearchField` (semantic search input)
- `AppInstallPrompt` (platform-aware install UX)

---

### Gap 4: No Platform Action Layer (MEDIUM PRIORITY)

**Current state**: Capability checks scattered through feature code.

**Problem**: Same action implemented 3 different ways in different files.

**Solution**: Create `src/hooks/usePlatformAction.ts`

```typescript
type PlatformAction = 
  | 'sharePost' | 'copyLink' | 'installApp' 
  | 'enableNotifications' | 'setBadge' | 'openExternalUri';

export function usePlatformAction(action: PlatformAction) {
  const capabilities = usePlatformCapabilities();
  
  return {
    available: /* platform-specific check */,
    preferredLabel: /* platform-specific label */,
    icon: /* platform-aware icon */,
    run: /* platform-specific implementation */,
    fallback: /* graceful fallback */,
  };
}

// Usage in feature:
const share = usePlatformAction('sharePost');
<button disabled={!share.available} onClick={share.run}>
  <AppIcon name={share.icon} />
  {share.preferredLabel}
</button>
```

---

### Gap 5: Dark Mode / Appearance Plumbing Incomplete (MEDIUM PRIORITY)

**Current state**: Platform detection exists, but appearance state not fully wired.

**Problems**:
- No `useAppearance()` hook (appearance mode: light/dark/dim/system)
- No resolved appearance (dark mode respects `prefers-color-scheme` but not explicit user choice)
- CSS has `color-scheme: light dark` but no dynamic update on mode change

**Solution**: Create `src/hooks/useAppearance.ts`

```typescript
export type AppearanceMode = 'system' | 'light' | 'dark' | 'dim';

export function useAppearance() {
  const [mode, setMode] = useLocalStorage<AppearanceMode>('appearance-mode', 'system');
  
  const resolved = useMemo(() => {
    if (mode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return mode === 'dim' ? 'dark' : mode;
  }, [mode]);
  
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  
  return { mode, setMode, resolved };
}
```

---

### Gap 6: PWA Metadata Incomplete (LOW PRIORITY)

**Current state**: `public/manifest.json` exists with basic config.

**Missing**:
- Screenshots (for rich install prompts)
- Additional shortcuts (Compose, Search, Inbox)
- Share target (Android share integration)
- Protocol handlers (Nostr URIs)
- Dark mode theme color meta tags

**Solution**: Update `public/manifest.json` and `public/index.html`

```json
{
  "id": "/",
  "name": "Paper",
  "short_name": "Paper",
  "display": "standalone",
  "screenshots": [
    { "src": "/icons/screenshot-narrow.png", "sizes": "540x720", "form_factor": "narrow" },
    { "src": "/icons/screenshot-wide.png", "sizes": "1280x720", "form_factor": "wide" }
  ],
  "shortcuts": [
    { "name": "Compose", "url": "/compose", "icons": [{ "src": "/icons/compose.png", "sizes": "96x96" }] },
    { "name": "Search", "url": "/search" }
  ],
  "share_target": {
    "action": "/share-target",
    "method": "GET",
    "params": { "title": "title", "text": "text", "url": "url" }
  },
  "protocol_handlers": [
    { "protocol": "web+nostr", "url": "/open?uri=%s" }
  ]
}
```

---

## High-Priority Implementation Checklist

### Phase 1: Icon Registry + PlatformUX (1–2 weeks)

- [ ] Create `src/design/icons/AppIcon.tsx` with semantic icon mapping
- [ ] Add ESLint rule to block direct Lucide imports
- [ ] Create `src/platform/usePlatformUX.ts` adapter
- [ ] Create `src/hooks/usePlatformAction.ts` action layer
- [ ] Test on: iPhone Safari, iPhone PWA, Android Chrome, Desktop Chrome

### Phase 2: AppKit Primitives (2–3 weeks)

- [ ] Create `src/components/app-kit/AppButton.tsx`
- [ ] Create `src/components/app-kit/AppNavBar.tsx`
- [ ] Create `src/components/app-kit/AppTabBar.tsx`
- [ ] Create `src/components/app-kit/AppList.tsx` + `AppCell.tsx`
- [ ] Create `src/components/app-kit/AppSheet.tsx`
- [ ] Create `src/components/app-kit/AppSearchField.tsx`
- [ ] Migrate TabBar component to use AppTabBar
- [ ] Test navigation, tab switching, sheet behaviors

### Phase 3: Appearance Plumbing (1 week)

- [ ] Create `src/hooks/useAppearance.ts`
- [ ] Wire appearance to CSS variables and Konsta dark prop
- [ ] Add light/dark mode toggle to settings
- [ ] Test dark mode on all platforms

### Phase 4: PWA Metadata + Install UX (1 week)

- [ ] Add screenshots to manifest
- [ ] Add shortcuts to manifest
- [ ] Implement share-target route
- [ ] Create platform-specific install UI
- [ ] Test on Android Chrome (beforeinstallprompt) and iOS (Add to Home Screen)

### Phase 5: Motion + Gesture Policy (1 week)

- [ ] Define motion presets in `src/design/motion.ts`
- [ ] Wire reduced-motion detection to all animations
- [ ] Define gesture policy by platform (swipe-back on iOS, ripple on Android)
- [ ] Test scroll feel and overscroll behavior

### Phase 6: Refactor Large Components (2–3 weeks)

- [ ] Identify oversized pages (e.g., FeedPage, SearchPage)
- [ ] Extract smaller focused sub-components
- [ ] Move view-model logic into custom hooks
- [ ] Keep components pure and platform-unaware

---

## Recommended Architecture After Implementation

```
src/
  design/
    platform/
      detectPlatform.ts           ← already have
      resolvePlatformUX.ts        ← NEW
      platformTypes.ts             ← already have (capabilities.ts)
    tokens/
      foundation.ts               ← already have
      semantic.ts                 ← already have
      components.ts               ← already have
      motion.ts                   ← already have
    icons/
      AppIcon.tsx                 ← NEW (registry)
      index.ts                    ← NEW (semantic names)
  components/
    app-kit/                      ← NEW primitives layer
      AppButton.tsx
      AppNavBar.tsx
      AppTabBar.tsx
      AppList.tsx / AppCell.tsx
      AppSheet.tsx
      AppSearchField.tsx
      AppInstallPrompt.tsx
    bridges/                       ← already have
      PlatformCapabilityBridge.tsx
      AppleEnhancementBridge.tsx
      AndroidEnhancementBridge.tsx
  hooks/
    usePlatformCapabilities.ts    ← already have
    usePlatformUX.ts              ← NEW
    usePlatformAction.ts          ← NEW
    useAppearance.ts              ← NEW
    useReducedMotion.ts           ← NEW
  pages/
    feed/                         ← refactor into sub-components
    search/
    profile/

Feature code should look like:
  import { AppButton, AppNavBar, AppSheet } from '~/components/app-kit';
  import { AppIcon } from '~/design/icons';
  import { usePlatformUX } from '~/platform/usePlatformUX';
  
Feature code should NOT look like:
  import { Search } from 'lucide-react';              ❌
  import Button from 'konsta/react/Button';          ❌
  className="px-4 py-2 bg-blue-500 rounded"          ❌
```

---

## Device Testing Matrix

Before considering the work "done," validate on this matrix:

| Device | Browser | Install | Status |
|--------|---------|---------|--------|
| iPhone | Safari | Browser | ✓ |
| iPhone | Safari | PWA | ✓ |
| iPad | Safari | Browser | ✓ |
| iPad | Safari | PWA | ✓ |
| macOS | Safari | Browser | ✓ |
| macOS | Safari | Dock App | ✓ |
| Android | Chrome | Browser | ✓ |
| Android | Chrome | PWA | ✓ |
| Desktop | Chrome | — | ✓ |
| Desktop | Firefox | — | ✓ |

For each, score:
- Safe area handling
- Tab/nav placement
- Sheet behavior
- Keyboard behavior
- Back navigation
- Install/update prompts
- Status bar color
- Reduced motion
- Offline shell

---

## What NOT to Do

❌ **Don't wrap with Capacitor or TWA yet**. Your PWA foundation is solid. Native wrappers only matter if you need App Store distribution or deeper native plugins.

❌ **Don't introduce platform-specific feature code in pages**. Use `usePlatformUX()` and AppKit primitives instead.

❌ **Don't skip ESLint enforcement**. Once the icon registry exists, lock it down immediately.

❌ **Don't ship without device testing**. Emulation in Chrome DevTools will miss scroll feel, keyboard handling, safe areas, and install UX.

---

## Summary

Paper-atproto's foundation is **already 70–75% of the way** to "native Apple feel by default, Android-native on Android." The remaining work is **layering governance on top of existing tokens**.

**Start with Gap 1 and Gap 2** (icon registry + PlatformUX adapter). These unblock all other work and are the highest ROI for "feels native."

**Then AppKit primitives** (Gap 3). This prevents design drift.

**Then appearance plumbing** (Gap 5). Dark mode is table stakes.

**Do not rewrite.** Extend the existing platform/design/bridges infrastructure. It's well-designed.

