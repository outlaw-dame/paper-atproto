import { describe, expect, it } from 'vitest';
import { actorLabelChips } from './labelPresentation';

describe('actorLabelChips', () => {
  it('maps labels into compact chips with external labeller signal', () => {
    const chips = actorLabelChips({
      actorDid: 'did:plc:alice',
      labels: [
        { val: 'porn', src: 'did:plc:labeller' },
        { val: 'spam', src: 'did:plc:labeller' },
      ],
      maxChips: 4,
    });

    expect(chips.map((chip) => chip.text)).toEqual([
      'Adult',
      'Spam',
      'External labeller',
    ]);
  });

  it('marks self-label when labels come from actor DID', () => {
    const chips = actorLabelChips({
      actorDid: 'did:plc:alice',
      labels: [{ val: 'nsfw', src: 'did:plc:alice' }],
      maxChips: 3,
    });

    expect(chips.map((chip) => chip.text)).toEqual(['Adult', 'Self-label']);
  });

  it('drops neg labels and invalid values', () => {
    const chips = actorLabelChips({
      actorDid: 'did:plc:alice',
      labels: [
        { val: 'spam', src: 'did:plc:labeller', neg: true },
        { val: '', src: 'did:plc:labeller' },
        { val: 'misleading', src: 'did:plc:labeller' },
      ],
    });

    expect(chips.map((chip) => chip.text)).toEqual(['Misleading', 'External labeller']);
  });
});
