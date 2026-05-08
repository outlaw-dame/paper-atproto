import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ValidationError } from './errors.js';

const DENYLIST_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.azure.internal',
  '169.254.169.254.nip.io',
]);

function normalizeHostname(rawHostname: string): string {
  return rawHostname.trim().toLowerCase().replace(/\.$/, '');
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map((v) => Number.parseInt(v, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return true;
  const [a, b] = parts;
  if (a === undefined || b === undefined) return true;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast/reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true; // link-local
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // unique-local
  if (normalized.startsWith('ff')) return true; // multicast
  if (normalized.startsWith('::ffff:')) {
    const maybeIpv4 = normalized.slice('::ffff:'.length);
    return isIP(maybeIpv4) === 4 ? isPrivateIpv4(maybeIpv4) : true;
  }
  return false;
}

function assertPublicIp(hostname: string, ip: string): void {
  const family = isIP(ip);
  if (family === 4 && isPrivateIpv4(ip)) {
    throw new ValidationError(`Remote URL resolves to a private IPv4 address for host ${hostname}.`);
  }
  if (family === 6 && isPrivateIpv6(ip)) {
    throw new ValidationError(`Remote URL resolves to a private IPv6 address for host ${hostname}.`);
  }
  if (family === 0) {
    throw new ValidationError(`Remote URL host ${hostname} did not resolve to a valid IP address.`);
  }
}

export async function assertSafeResolvedRemoteUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError('Invalid remote URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ValidationError('Only http(s) remote URLs are allowed.');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    throw new ValidationError('Remote URL hostname is required.');
  }

  if (DENYLIST_HOSTNAMES.has(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    throw new ValidationError('Remote URL hostname is not allowed.');
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new ValidationError('Remote URL hostname is not allowed.');
  }

  const directFamily = isIP(hostname);
  if (directFamily === 4 || directFamily === 6) {
    assertPublicIp(hostname, hostname);
    return;
  }

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new ValidationError(`Unable to resolve remote host ${hostname}.`);
  }

  if (!addresses.length) {
    throw new ValidationError(`Remote host ${hostname} did not resolve.`);
  }

  for (const entry of addresses) {
    assertPublicIp(hostname, entry.address);
  }
}
