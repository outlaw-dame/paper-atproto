import React from 'react';

interface EmojiProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Renders text with the platform emoji font instead of image emoji.
 *
 * On Apple platforms this lets Safari/WebKit use Apple Color Emoji, which feels
 * much closer to Messages, Notes, and other native iOS/macOS surfaces than
 * Twemoji image replacement. Non-Apple platforms fall through to their native
 * color emoji fonts.
 */
export const Emoji: React.FC<EmojiProps> = ({ children, className }) => {
  return (
    <span
      className={['emoji-native', className].filter(Boolean).join(' ')}
    >
      {children}
    </span>
  );
};
