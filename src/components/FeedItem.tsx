import React from 'react';
import { motion } from 'framer-motion';
import { Block, Card, List, ListItem } from 'konsta/react';
import { Markdown } from './Markdown';
import { Gif } from './Gif';
import { LinkPreview } from './LinkPreview';

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
  };
  onClick?: () => void;
}

/**
 * An immersive feed item component inspired by Facebook Paper.
 * Uses Konsta UI for the base and Framer Motion for subtle animations.
 */
export const FeedItem: React.FC<FeedItemProps> = ({ post, onClick }) => {
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
              <div className="font-bold text-sm dark:text-white">
                {post.author.displayName || post.author.handle}
              </div>
              <div className="text-xs text-zinc-500">
                @{post.author.handle} • {new Date(post.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
          <div className="text-base leading-relaxed dark:text-zinc-200">
            <Markdown content={post.content} />
          </div>
          {post.embed?.type === 'app.bsky.embed.external' && (
            post.embed.external.uri.includes('tenor.com') ? (
              <Gif 
                url={post.embed.external.uri} 
                title={post.embed.external.title} 
                thumbnail={post.embed.external.thumb} 
              />
            ) : (
              <LinkPreview
                url={post.embed.external.uri}
                title={post.embed.external.title}
                description={post.embed.external.description}
                image={post.embed.external.thumb}
              />
            )
          )}
        </div>
      </Card>
    </motion.div>
  );
};
