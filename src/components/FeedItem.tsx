import React from 'react';
import { motion } from 'framer-motion';
import { Card } from 'konsta/react';
import { Markdown } from './Markdown.js';
import { Gif } from './Gif.js';
import { LinkPreview } from './LinkPreview.js';
import { useProfileNavigation } from '../hooks/useProfileNavigation.js';

interface FeedItemProps {
  post: {
    id: string;
    author: {
      handle: string;
      displayName?: string;
      avatar?: string;
    };
    content: string;
    createdAt: string;
    embed?: any;
    entities?: any[];
  };
  onClick?: () => void;
}

/**
 * An immersive feed item component inspired by Facebook Paper.
 * Uses Konsta UI for the base and Framer Motion for subtle animations.
 */
export const FeedItem: React.FC<FeedItemProps> = ({ post, onClick }) => {
  // Parse embed if it's a string (from DB)
  const embed = typeof post.embed === 'string' ? JSON.parse(post.embed) : post.embed;
  const navigateToProfile = useProfileNavigation();

  return (
    <motion.div
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="cursor-pointer"
    >
      <Card
        margin="m-4"
        className="overflow-hidden rounded-xl shadow-lg border-none bg-white dark:bg-zinc-900"
      >
        <div className="p-4">
          <div className="flex items-center mb-3">
            {post.author.avatar ? (
              <img
                src={post.author.avatar}
                alt={post.author.handle}
                className="w-10 h-10 rounded-full mr-3"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-zinc-200 dark:bg-zinc-700 mr-3 flex items-center justify-center">
                <span className="text-zinc-500 text-sm font-bold">
                  {post.author.handle[0].toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <button
                className="interactive-link-button"
                onClick={(event) => { event.stopPropagation(); void navigateToProfile(post.author.handle); }}
                style={{ justifyContent: 'flex-start' }}
              >
                <div className="font-bold text-sm dark:text-white">
                  {post.author.displayName || post.author.handle}
                </div>
              </button>
              <button
                className="interactive-link-button"
                onClick={(event) => { event.stopPropagation(); void navigateToProfile(post.author.handle); }}
                style={{ justifyContent: 'flex-start' }}
              >
                <div className="text-xs text-zinc-500">
                  @{post.author.handle} • {new Date(post.createdAt).toLocaleDateString()}
                </div>
              </button>
            </div>
          </div>
          <div className="text-base leading-relaxed dark:text-zinc-200">
            <Markdown content={post.content} />
          </div>
          {post.entities && post.entities.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {post.entities.map((entity, idx) => (
                <div 
                  key={idx}
                  className="px-2 py-1 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md text-xs font-medium flex items-center"
                  title={entity.type}
                >
                  <span className="mr-1">🏷️</span>
                  {entity.text}
                  {entity.wikidata_id && (
                    <a 
                      href={`https://www.wikidata.org/wiki/${entity.wikidata_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-1 opacity-50 hover:opacity-100"
                      onClick={(e) => e.stopPropagation()}
                    >
                      (wiki)
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          {embed?.type === 'app.bsky.embed.external' && (
            embed.external.uri.includes('tenor.com') ? (
              <Gif 
                url={embed.external.uri} 
                title={embed.external.title} 
                thumbnail={embed.external.thumb} 
              />
            ) : (
              <LinkPreview
                url={embed.external.uri}
                title={embed.external.title}
                description={embed.external.description}
                image={embed.external.thumb}
              />
            )
          )}
        </div>
      </Card>
    </motion.div>
  );
};
