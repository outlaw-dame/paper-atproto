// ─── Notifications Module ─────────────────────────────────────────────────────
// Barrel exports for the push notification layer.
//
// Architecture:
//   pushRuntime.ts        → determines which channel (APNs/FCM/web-push)
//   nativePush.ts         → Capacitor plugin lifecycle (native only)
//   pushTokenService.ts   → server-side token registration + revocation
//   (web push)            → handled by service worker (public/sw.js)

export { getPushChannel, isPushAvailable } from '../native/pushRuntime';
export type { PushChannel } from '../native/pushRuntime';

export {
  registerPushToken,
  revokePushToken,
  hasRegisteredToken,
} from './pushTokenService';
export type { PushTokenRecord, PushTokenRegistrationResult } from './pushTokenService';

export {
  initNativePushListeners,
  setNativePushHandlers,
  checkNativePushPermission,
  requestNativePushPermission,
  unregisterNativePush,
  clearNativeNotifications,
} from '../native/nativePush';
export type { NativePushToken, NativePushHandlers } from '../native/nativePush';
