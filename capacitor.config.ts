import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize } from '@capacitor/keyboard';

const config: CapacitorConfig = {
  appId: 'social.glympse.app',
  appName: 'Glympse',
  webDir: 'dist',
  server: {
    // Use https scheme on Android to match browser behavior for cookies,
    // localStorage, and CORS. Without this, Android WebView uses http://
    // which breaks same-site cookie policies and mixed-content guards.
    androidScheme: 'https',
  },
  plugins: {
    App: {
      // Let Framework7 and the app's own overlay stack own Android back
      // button behavior. Capacitor's default handler calls history.back()
      // which conflicts with the app's overlay-first dismissal logic.
      disableBackButtonHandler: true,
    },
    SplashScreen: {
      launchShowDuration: 350,
      backgroundColor: '#F2F2F7',
      showSpinner: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#F2F2F7',
      overlaysWebView: false,
    },
    Keyboard: {
      // Resize the web view when the keyboard appears rather than pushing
      // the viewport. This avoids layout thrash on iOS when the composer
      // is open and the user scrolls.
      resize: KeyboardResize.Body,
      resizeOnFullScreen: true,
    },
  },
};

export default config;
