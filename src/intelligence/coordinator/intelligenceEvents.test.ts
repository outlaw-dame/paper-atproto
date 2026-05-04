import { afterEach, describe, expect, it } from 'vitest';
import {
  __resetIntelligenceEventsForTesting,
  emitIntelligenceEvent,
  getIntelligenceEventBufferSnapshot,
  INTELLIGENCE_EVENT_SCHEMA_VERSION,
  subscribeToIntelligenceEvents,
} from './intelligenceEvents';

afterEach(() => {
  __resetIntelligenceEventsForTesting();
});

describe('intelligenceEvents.emitIntelligenceEvent', () => {
  it('produces a frozen, schema-versioned event with sanitized reason codes', () => {
    const event = emitIntelligenceEvent({
      surface: 'router',
      task: 'composer_writer',
      lane: 'server_writer',
      status: 'succeeded',
      durationMs: 42,
      deterministicFallback: false,
      reasonCodes: [
        ' router_pick ',
        'router_pick', // dup
        'bad\u0000code',
        'x'.repeat(200), // truncated
        '',
        ...Array.from({ length: 12 }, (_, i) => `extra_${i}`), // exceed cap
      ],
    });
    expect(event.schemaVersion).toBe(INTELLIGENCE_EVENT_SCHEMA_VERSION);
    expect(Object.isFrozen(event)).toBe(true);
    expect(event.reasonCodes.length).toBeLessThanOrEqual(8);
    expect(event.reasonCodes[0]).toBe('router_pick');
    expect(event.reasonCodes).not.toContain('');
    expect(event.reasonCodes.some((r) => r.includes('\u0000'))).toBe(false);
    expect(event.reasonCodes.some((r) => r.length > 56)).toBe(false);
  });

  it('drops non-finite duration and never throws', () => {
    const event = emitIntelligenceEvent({
      surface: 'edge',
      status: 'errored',
      durationMs: Number.POSITIVE_INFINITY,
    });
    expect(event.durationMs).toBeUndefined();
  });

  it('sanitizes details: drops bad keys/values, caps strings, freezes object', () => {
    const event = emitIntelligenceEvent({
      surface: 'session',
      status: 'succeeded',
      details: {
        good_key: 'ok',
        '..bad/key': 'value',
        big: 'x'.repeat(500),
        nope: { obj: 1 } as unknown as string,
        list: ['a', 'b', 12, true, NaN as unknown as number],
        nan: NaN,
      },
    });
    expect(event.details).toBeDefined();
    const d = event.details ?? {};
    expect(d.good_key).toBe('ok');
    expect(typeof d.big).toBe('string');
    expect((d.big as string).length).toBeLessThanOrEqual(120);
    expect(d.nope).toBeUndefined();
    expect(d.nan).toBeUndefined();
    expect(Array.isArray(d.list)).toBe(true);
  });

  it('records every emit into the ring buffer in chronological order', () => {
    for (let i = 0; i < 5; i += 1) {
      emitIntelligenceEvent({ surface: 'session', status: 'planned', reasonCodes: [`step_${i}`] });
    }
    const snap = getIntelligenceEventBufferSnapshot();
    expect(snap.size).toBe(5);
    expect(snap.totalEmitted).toBe(5);
    expect(snap.events.map((e) => e.reasonCodes[0])).toEqual([
      'step_0',
      'step_1',
      'step_2',
      'step_3',
      'step_4',
    ]);
  });

  it('fans out to subscribers and quarantines a throwing subscriber', () => {
    const seen: string[] = [];
    subscribeToIntelligenceEvents((ev) => {
      seen.push(ev.surface);
    });
    let throwsCount = 0;
    subscribeToIntelligenceEvents(() => {
      throwsCount += 1;
      throw new Error('boom');
    });
    emitIntelligenceEvent({ surface: 'session', status: 'planned' });
    emitIntelligenceEvent({ surface: 'router', status: 'started' });
    expect(seen).toEqual(['session', 'router']);
    // Throwing subscriber should only be invoked once before quarantine.
    expect(throwsCount).toBe(1);
  });

  it('caps the ring buffer and exposes monotonically increasing totalEmitted', () => {
    for (let i = 0; i < 300; i += 1) {
      emitIntelligenceEvent({ surface: 'session', status: 'planned' });
    }
    const snap = getIntelligenceEventBufferSnapshot();
    expect(snap.size).toBe(snap.capacity);
    expect(snap.totalEmitted).toBe(300);
  });
});
