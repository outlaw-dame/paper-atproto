// ─── ESLint Config ───────────────────────────────────────────────────────────
// Enforces design system discipline:
//   1. No direct imports from lucide-react, konsta, or icon libraries
//   2. Use NativeIcon component registry instead
//   3. Prevents platform-specific UI leakage into feature code

export default [
  {
    files: ['src/**/*.{ts,tsx}', 'server/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // ─── Design System Enforcement ────────────────────────────────────────
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'lucide-react',
              message:
                'Use NativeIcon from src/components/native/NativeIcon instead. ' +
                'This ensures consistent icon styling across platforms (iOS/Material).',
              importNames: ['default'],
            },
            {
              name: 'konsta/react',
              message:
                'Import from NativeButton, NativeSheet, etc. in src/components/native instead. ' +
                'This ensures platform-specific styling is applied.',
            },
            {
              name: 'framework7-icons/react',
              message:
                'Use NativeIcon from src/components/native/NativeIcon instead.',
            },
            {
              name: 'react-icons/md',
              message:
                'Use NativeIcon from src/components/native/NativeIcon instead.',
            },
            {
              name: 'ionicons/icons',
              message:
                'Use NativeIcon from src/components/native/NativeIcon instead.',
            },
          ],
          patterns: [
            {
              group: ['**/components/*/NativeButton', '**/components/*/NativeSheet'],
              message: 'Import from src/components/native instead (re-exported via index.ts).',
              importNames: ['default'],
            },
          ],
        },
      ],

      // ─── Capability Usage ─────────────────────────────────────────────────
      // Use usePlatformAction and usePlatformUX instead of raw capability checks.
      // This is a warning (not error) because there are legitimate escape hatches.
      // But encourage consolidation in PlatformAction and PlatformUX layers.
      'no-restricted-properties': [
        'warn',
        {
          object: 'runtime',
          property: 'capabilities',
          message:
            'Access capabilities through usePlatformUX() or usePlatformAction() instead. ' +
            'This ensures consistent platform behavior across the app.',
        },
      ],
    },
  },
];
