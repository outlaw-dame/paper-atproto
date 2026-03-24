import { ValidationError } from './errors.js';
import { env } from '../config/env.js';

export function sanitizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim().slice(0, env.VERIFY_MAX_TEXT_CHARS);
}

export function isSafeHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function sanitizeUrls(urls: string[] | undefined | null): string[] {
  if (!urls?.length) return [];
  return urls.map((u) => u.trim()).filter(Boolean).filter(isSafeHttpUrl).slice(0, env.VERIFY_MAX_URLS);
}

export function requireNonEmptyText(value: string, field = 'text'): string {
  const sanitized = sanitizeText(value);
  if (!sanitized) throw new ValidationError(`${field} must not be empty`);
  return sanitized;
}

export function redactForLogs(value: string): string {
  const clean = sanitizeText(value);
  if (clean.length <= 80) return clean;
  return `${clean.slice(0, 80)}…`;
}
