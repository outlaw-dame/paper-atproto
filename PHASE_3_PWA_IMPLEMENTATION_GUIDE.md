# Phase 3: PWA Metadata & Install Prompts - Implementation Guide

## Current Status Analysis

### ✅ Already Implemented
1. **manifest.json** - Comprehensive configuration:
   - ✅ Basic metadata (name, description, start_url, scope, display modes)
   - ✅ Icons (192x192 and 512x512 with maskable support)
   - ✅ Shortcuts (New Post, Explore)
   - ✅ share_target configured for GET requests
   - ✅ protocol_handlers for web+at scheme
   - ✅ Screenshots array with narrow and wide form factors (references exist but image files need creation)
   - ✅ Categories, lang, prefer_related_applications

2. **index.html** - Strong Apple & PWA support:
   - ✅ viewport meta with viewport-fit=cover (safe area support)
   - ✅ theme-color media query for light/dark modes
   - ✅ apple-touch-icon reference
   - ✅ manifest reference
   - ✅ apple-mobile-web-app-capable
   - ✅ apple-mobile-web-app-status-bar-style (black-translucent)
   - ✅ Early theme sync script to prevent flash
   - ✅ Dual theme-color for system preference matching

3. **PWA Handlers** - Already implemented:
   - ✅ shareTarget.ts - Processes incoming OS share requests
   - ✅ share-target custom event dispatch on window
   - ✅ Query parameter parsing and restoration

### ⚠️ Needs Completion

#### 1. Screenshot Images
**Status**: manifest.json references files that don't exist
- `public/screenshots/iphone-home.png` (1179x2556 narrow form factor)
- `public/screenshots/desktop-reader.png` (2880x1800 wide form factor)

**Action**: 
- Create `public/screenshots/` directory
- Generate/create PNG screenshots matching manifest references
- Or update manifest to reference actual screenshot files

#### 2. Protocol Handler Route (/open)
**Status**: Handler defined in manifest but no route implementation
- manifest.json references `/paper-atproto/open?uri=%s`
- Needs to parse the URI parameter and navigate to the referenced ATProto entity

**Action**:
- Create `src/pwa/protocolHandler.ts` similar to shareTarget.ts
- Parse `uri` query parameter
- Emit custom event `paper:protocol-handler` on window
- Clear URL params and navigate to clean state
- Handle invalid/malformed URIs gracefully

**Expected Protocol Formats**:
- `web+at://did:plc:...` - User profile
- `web+at://at://did:plc:.../app.bsky.feed.post/...` - Post reference
- `web+at://handle.bsky.social` - Handle resolution

#### 3. Protocol Handler App Integration
**Status**: Handler functions exist but not wired to UI
- Need to listen for `paper:protocol-handler` event in App.tsx or a bridge component
- Navigate to appropriate tab/entity based on parsed URI

**Action**:
- Create `src/components/ProtocolHandlerBridge.tsx`
- Listen for `paper:protocol-handler` custom event
- Parse URI and determine destination (profile, post, handle)
- Trigger appropriate navigation (openProfile, openThread, etc.)
- Handle loading states and error cases

#### 4. Share Target Integration (Verify Complete)
**Status**: Handler exists but verify wiring
- shareTarget.ts exists and emits `paper:share-target` event
- Need to verify App or a bridge listens to this event

**Action**:
- Search codebase for listeners of `paper:share-target` event
- If not found, create `src/components/ShareTargetBridge.tsx`
- Listen for share event and populate compose sheet with shared content
- Extract title, text, url from payload

#### 5. Install Prompt Enhancement
**Status**: Basic install detection exists, but could be enhanced
- beforeinstallprompt event handling
- Custom install UI (already defined in usePlatformAction)

**Action**:
- Create `src/components/InstallPromptBridge.tsx`
- Listen for beforeinstallprompt event
- Show platform-appropriate install prompt at strategic moments
- Track install state and dismiss permanently if declined
- Use usePlatformAction('installApp') for prompting

#### 6. Badge Integration
**Status**: Badge API support exists (BadgeSyncBridge already in App.tsx)
- Verify badge updates work for notification count

**Action**:
- Test badge functionality via usePlatformAction('openBadgeSettings')
- Ensure notifications update badge via navigator.setAppBadge(count)

#### 7. Apple-Specific Enhancements (Optional)
**Status**: Basic support exists, could enhance
- apple-mobile-web-app-title already set
- status-bar-style already set

**Possible Additions**:
- apple-mobile-web-app-status-bar-style variations per page
- SVG icon optimization for Apple Touch Icon
- iOS-specific link prefetching

---

## Implementation Priority

### High Priority (Blocking)
1. **Screenshot Images** - Required for app store listings
   - Create placeholder images or generate real screenshots
   - Update manifest.json paths if needed
   
2. **Protocol Handler Route** - web+at:// URIs won't work without this
   - Create protocolHandler.ts
   - Implement /open route handling
   - Wire to App via ProtocolHandlerBridge

3. **Share Target Bridge** - Share functionality won't work without listener
   - Verify existing listener or create ShareTargetBridge
   - Test OS share integration

### Medium Priority (Enhances UX)
4. **Install Prompt Bridge** - Better install experience
   - Create InstallPromptBridge
   - Show prompt at strategic moments
   - Track and respect user dismissal

5. **Status Bar Dynamics** - Better platform integration
   - Adjust status bar style per screen
   - Match theme preferences

### Low Priority (Polish)
6. **Badge Integration Testing** - Ensure notifications work
7. **Apple Specific Optimizations** - Minor UX improvements

---

## Code Examples

### protocolHandler.ts (To Be Created)

```typescript
/**
 * Processes incoming web+at:// protocol handler requests.
 * Called when user taps a link in another app that uses the web+at scheme.
 * 
 * Examples:
 *   web+at://did:plc:xxx → open profile
 *   web+at://at://did:plc:xxx/app.bsky.feed.post/yyy → open post
 */

export interface ProtocolPayload {
  uri: string;
  type: 'profile' | 'post' | 'handle' | 'unknown';
  parsed?: {
    did?: string;
    handle?: string;
    postId?: string;
  };
}

export function parseProtocolUri(uri: string): ProtocolPayload | null {
  try {
    // Remove web+at:// prefix
    const cleaned = uri.replace(/^web\+at:\/\//i, '');
    
    // Detect type and parse
    if (cleaned.startsWith('did:')) {
      // User profile by DID
      return {
        uri: cleaned,
        type: 'profile',
        parsed: { did: cleaned },
      };
    }
    
    if (cleaned.startsWith('at://')) {
      // ATProto reference (post, etc.)
      const parsed = cleaned.replace('at://', '');
      return {
        uri: cleaned,
        type: 'post',
        parsed: { postId: parsed },
      };
    }
    
    if (cleaned.includes('.')) {
      // Likely a handle
      return {
        uri: cleaned,
        type: 'handle',
        parsed: { handle: cleaned },
      };
    }
    
    return { uri, type: 'unknown' };
  } catch (err) {
    console.error('[protocolHandler] Failed to parse URI:', err);
    return null;
  }
}

export function initProtocolHandler(): void {
  if (typeof window === 'undefined') return;
  
  const handleProtocol = () => {
    const params = new URLSearchParams(window.location.search);
    const uri = params.get('uri');
    
    if (!uri) return;
    
    const payload = parseProtocolUri(uri);
    if (!payload) return;
    
    // Emit event for App/bridge to listen to
    window.dispatchEvent(
      new CustomEvent<ProtocolPayload>('paper:protocol-handler', {
        detail: payload,
      }),
    );
    
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  };
  
  // Check on init and on hash change
  handleProtocol();
  window.addEventListener('hashchange', handleProtocol);
}
```

### ProtocolHandlerBridge.tsx (To Be Created)

```typescript
import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import type { ProtocolPayload } from '../pwa/protocolHandler';

export default function ProtocolHandlerBridge() {
  const openProfile = useUiStore((s) => s.openProfile);
  const openThread = useUiStore((s) => s.openThread);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<ProtocolPayload>;
      const payload = customEvent.detail;

      console.log('[ProtocolHandlerBridge] Handling:', payload);

      if (payload.type === 'profile' && payload.parsed?.did) {
        openProfile(payload.parsed.did);
      } else if (payload.type === 'handle' && payload.parsed?.handle) {
        // TODO: resolve handle to DID first
        console.warn('[ProtocolHandlerBridge] Handle resolution not yet implemented');
      } else if (payload.type === 'post' && payload.parsed?.postId) {
        openThread(payload.parsed.postId);
      }
    };

    window.addEventListener('paper:protocol-handler', handler);
    return () => window.removeEventListener('paper:protocol-handler', handler);
  }, [openProfile, openThread]);

  return null; // Bridge component
}
```

### ShareTargetBridge.tsx (To Be Created or Verified)

```typescript
import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import type { SharedPayload } from '../pwa/shareTarget';

export default function ShareTargetBridge() {
  const openCompose = useUiStore((s) => s.openCompose);

  useEffect(() => {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent<SharedPayload>;
      const payload = customEvent.detail;

      console.log('[ShareTargetBridge] Handling share:', payload);

      // Populate compose with shared content
      openCompose({
        initialText: payload.text || '',
        sharedUrl: payload.url || '',
        sharedTitle: payload.title || '',
      });
    };

    window.addEventListener('paper:share-target', handler);
    return () => window.removeEventListener('paper:share-target', handler);
  }, [openCompose]);

  return null; // Bridge component
}
```

---

## Testing Checklist

### Android (Chrome)
- ☐ Install prompt appears (beforeinstallprompt + usePlatformAction)
- ☐ Share from another app lands on compose
- ☐ web+at:// links open in app
- ☐ Badge updates reflect notification count
- ☐ Status bar matches theme

### iOS (Safari)
- ☐ Add to Home Screen works (apple-mobile-web-app-capable)
- ☐ Status bar style is correct (black-translucent)
- ☐ Share from other apps works (via Safari share + manual copy)
- ☐ Icons render on home screen
- ☐ Safe area respected (viewport-fit=cover + --safe-top CSS var)

### Desktop (Chrome/Edge)
- ☐ Install prompt in browser (beforeinstallprompt)
- ☐ Install to Start Menu / Applications
- ☐ Protocol handler registers (web+at://)
- ☐ Screenshots show in about:apps

---

## Files to Create or Modify

### New Files
- [ ] `src/pwa/protocolHandler.ts` - Protocol URI parsing
- [ ] `src/components/ProtocolHandlerBridge.tsx` - Event listener
- [ ] `src/components/ShareTargetBridge.tsx` - Event listener (if not exists)
- [ ] `src/components/InstallPromptBridge.tsx` - Install UX
- [ ] `public/screenshots/iphone-home.png` - 1179x2556
- [ ] `public/screenshots/desktop-reader.png` - 2880x1800

### Files to Modify
- [ ] `src/App.tsx` - Add bridge components
- [ ] `public/manifest.json` - Verify paths/update if needed
- [ ] `index.html` - Verify all meta tags (mostly done)

---

## Summary

Phase 3 builds on the solid PWA foundation already in place. Most infrastructure exists; the work is:
1. Creating screenshot images for app store listings
2. Implementing protocol handler route parsing
3. Wiring event listeners to App state/navigation
4. Testing across platforms

Estimated effort: 4-6 hours for complete implementation and testing.
