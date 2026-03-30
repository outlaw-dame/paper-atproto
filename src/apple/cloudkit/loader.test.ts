import { describe, expect, it } from 'vitest';
import { CloudKitConfigError } from './errors.js';
import { sanitizeCloudKitScriptUrl } from './loader.js';

describe('sanitizeCloudKitScriptUrl', () => {
  it('accepts the official Apple CDN URL', () => {
    expect(sanitizeCloudKitScriptUrl('https://cdn.apple-cloudkit.com/ck/2/cloudkit.js')).toBe(
      'https://cdn.apple-cloudkit.com/ck/2/cloudkit.js',
    );
  });

  it('allows same-origin script overrides for local hosting', () => {
    expect(
      sanitizeCloudKitScriptUrl('/vendor/cloudkit.js', 'http://localhost:5181'),
    ).toBe('http://localhost:5181/vendor/cloudkit.js');
  });

  it('rejects foreign hosts even over HTTPS', () => {
    expect(() => sanitizeCloudKitScriptUrl('https://evil.example/cloudkit.js')).toThrow(
      CloudKitConfigError,
    );
  });

  it('rejects non-HTTPS remote URLs', () => {
    expect(() => sanitizeCloudKitScriptUrl('http://cdn.apple-cloudkit.com/ck/2/cloudkit.js')).toThrow(
      CloudKitConfigError,
    );
  });
});
