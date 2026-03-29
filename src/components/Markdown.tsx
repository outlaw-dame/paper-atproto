import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';
import rehypeRaw from 'rehype-raw';
import { Emoji } from './Emoji.js';
import { sanitizeExternalUrl } from '../lib/safety/externalUrl.js';

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Pre-processes content to handle Discord-flavored markdown features
 * like spoilers (||spoiler||) and blockquotes.
 */
const preprocessDiscordMarkdown = (content: string): string => {
  // Handle spoilers: ||text|| -> <span class="spoiler">text</span>
  let processed = content.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler">$1</span>');
  
  // Handle hashtags: #tag -> <a href="hashtag:tag" class="hashtag">#tag</a>
  // We use a custom protocol "hashtag:" to identify them in the renderer
  processed = processed.replace(/(^|\s)#(\w+)/g, '$1<a href="hashtag:$2" class="hashtag">#$2</a>');
  
  return processed;
};

/**
 * A robust Markdown component that supports GFM and Discord-flavored features.
 * It includes security sanitization and integrates with the Twemoji component.
 */
export const Markdown: React.FC<MarkdownProps> = ({ content, className }) => {
  const processedContent = preprocessDiscordMarkdown(content);

  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        components={{
          // Use the Emoji component for text nodes to ensure emojis are Twemojified
          text: ({ value }) => <Emoji>{value}</Emoji>,
          // Custom renderer for spoilers
          span: ({ node, className, children, ...props }) => {
            if (className === 'spoiler') {
              return (
                <span
                  className="bg-zinc-800 text-transparent hover:text-inherit transition-colors duration-200 cursor-pointer rounded px-1"
                  onClick={(e) => e.currentTarget.classList.remove('text-transparent')}
                  {...props}
                >
                  {children}
                </span>
              );
            }
            return <span className={className} {...props}>{children}</span>;
          },
          // Style other elements to match the Apple/Paper aesthetic
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-zinc-300 dark:border-zinc-700 pl-4 italic my-2">
              {children}
            </blockquote>
          ),
          code: ({ inline, children, className }) => (
            <code className={`${inline ? 'bg-zinc-100 dark:bg-zinc-800 px-1 rounded' : 'block bg-zinc-100 dark:bg-zinc-800 p-2 rounded my-2 overflow-x-auto'} ${className}`}>
              {children}
            </code>
          ),
          a: ({ href, children }) => {
            if (href?.startsWith('hashtag:')) {
              const tag = href.split(':')[1];
              return (
                <a
                  href="#"
                  className="text-blue-500 hover:underline font-medium"
                  onClick={(e) => {
                    e.preventDefault();
                    // Dispatch a custom event that App.tsx can listen to
                    window.dispatchEvent(new CustomEvent('hashtag-click', { detail: tag }));
                  }}
                >
                  {children}
                </a>
              );
            }
            const safeHref = href ? sanitizeExternalUrl(href) : null;
            if (!safeHref) {
              return <span>{children}</span>;
            }
            return (
              <a href={safeHref} className="text-blue-500 hover:underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  );
};
