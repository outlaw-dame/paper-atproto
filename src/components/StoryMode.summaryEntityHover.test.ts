import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WriterEntity } from '../intelligence/llmContracts';
import { renderSummaryText } from './storyModeSummaryText';

type EntityButtonProps = {
  onMouseEnter: (e: { stopPropagation: () => void }) => void;
  onFocus: (e: { stopPropagation: () => void }) => void;
};

function getEntityButton(nodes: React.ReactNode[]): React.ReactElement<EntityButtonProps> | null {
  for (const node of nodes) {
    if (!React.isValidElement(node)) continue;
    const element = node as React.ReactElement<EntityButtonProps>;
    if (element.type === 'button') return element;
  }
  return null;
}

describe('StoryMode summary entity interactions', () => {
  const entity: WriterEntity = {
    id: 'person-jane-doe',
    label: 'Jane Doe',
    type: 'person',
    confidence: 0.9,
    impact: 0.8,
  };

  it('activates entity handler on hover for linkified summary entities', () => {
    const onEntityTap = vi.fn();
    const nodes = renderSummaryText('Jane Doe provided context in the thread.', {
      summaryEntities: [{ entity, label: entity.label, normalizedLabel: entity.label.toLowerCase() }],
      onEntityTap,
    });

    const button = getEntityButton(nodes);
    expect(button).not.toBeNull();
    const buttonProps = button!.props;

    const stopPropagation = vi.fn();
    buttonProps.onMouseEnter({
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onEntityTap).toHaveBeenCalledTimes(1);
    expect(onEntityTap).toHaveBeenCalledWith(entity);
  });

  it('activates entity handler on focus for keyboard navigation', () => {
    const onEntityTap = vi.fn();
    const nodes = renderSummaryText('Jane Doe provided context in the thread.', {
      summaryEntities: [{ entity, label: entity.label, normalizedLabel: entity.label.toLowerCase() }],
      onEntityTap,
    });

    const button = getEntityButton(nodes);
    expect(button).not.toBeNull();
    const buttonProps = button!.props;

    const stopPropagation = vi.fn();
    buttonProps.onFocus({
      stopPropagation,
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(onEntityTap).toHaveBeenCalledTimes(1);
    expect(onEntityTap).toHaveBeenCalledWith(entity);
  });
});
