import React from 'react';
import Twemoji from 'react-twemoji';

interface EmojiProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * A reusable component that renders emojis using Twemoji for cross-platform consistency.
 * It wraps the content and automatically replaces native emojis with Twemoji images.
 */
export const Emoji: React.FC<EmojiProps> = ({ children, className }) => {
  const TwemojiComponent =
    (Twemoji as unknown as { default?: React.ComponentType<any> }).default
    ?? (Twemoji as unknown as React.ComponentType<any>);

  if (typeof TwemojiComponent !== 'function') {
    return <>{children}</>;
  }

  return (
    <TwemojiComponent
      tag="span"
      options={{ className: `twemoji inline-block w-[1em] h-[1em] align-[-0.1em] mx-[0.05em] ${className || ''}` }}
    >
      {children}
    </TwemojiComponent>
  );
};
