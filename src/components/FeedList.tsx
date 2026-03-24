import React, { useState, useEffect } from 'react';
import { List, ListItem, Block, Button, Searchbar, Card, Navbar, Page, Toolbar, Link } from 'konsta/react';
import { feedService } from '../feeds.js';
import type { Feed, FeedItem } from '../schema.js';

/**
 * FeedList Component for managing and consuming ATOM/RSS/JSON feeds.
 */

export const FeedList: React.FC = () => {
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [selectedFeed, setSelectedFeed] = useState<Feed | null>(null);
  const [feedItems, setFeedItems] = useState<FeedItem[]>([]);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    loadFeeds();
  }, []);

  const loadFeeds = async () => {
    const result = await feedService.getFeeds();
    setFeeds(result);
  };

  const handleAddFeed = async () => {
    if (!newFeedUrl.trim()) return;
    setIsLoading(true);
    try {
      await feedService.addFeed(newFeedUrl);
      setNewFeedUrl('');
      loadFeeds();
    } catch (error) {
      alert('Failed to add feed. Please check the URL.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectFeed = async (feed: Feed) => {
    setSelectedFeed(feed);
    const items = await feedService.getFeedItems(feed.id);
    // Map snake_case from DB to camelCase for UI
    const mappedItems = items.map((item: any) => ({
      ...item,
      pubDate: item.pub_date,
      enclosureUrl: item.enclosure_url,
      enclosureType: item.enclosure_type,
    }));
    setFeedItems(mappedItems);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-50 dark:bg-zinc-950">
      <Navbar
        title="Feeds"
        subtitle={selectedFeed ? selectedFeed.title || '' : 'News, Podcasts, Videos'}
        left={selectedFeed && (
          <Link onClick={() => setSelectedFeed(null)}>Back</Link>
        )}
      />

      {!selectedFeed ? (
        <div className="flex-1 overflow-auto">
          <Block strong inset className="mt-4">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter RSS/Atom/JSON Feed URL"
                className="flex-1 px-3 py-2 border rounded-md dark:bg-zinc-900 dark:border-zinc-800"
                value={newFeedUrl}
                onChange={(e) => setNewFeedUrl(e.target.value)}
              />
              <Button 
                onClick={handleAddFeed} 
                loading={isLoading}
                className="w-24"
              >
                Add
              </Button>
            </div>
          </Block>

          <List strong inset>
            {feeds.length === 0 ? (
              <ListItem title="No feeds added yet" />
            ) : (
              feeds.map((feed) => (
                <ListItem
                  key={feed.id}
                  title={feed.title || 'Untitled Feed'}
                  subtitle={feed.category || 'News'}
                  text={feed.url}
                  link
                  onClick={() => handleSelectFeed(feed)}
                />
              ))
            )}
          </List>
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4 space-y-4">
          {feedItems.map((item) => (
            <Card key={item.id} margin="m-0" className="overflow-hidden">
              <div className="p-4">
                <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 mb-1 uppercase tracking-wider">
                  {selectedFeed.category || 'News'}
                </div>
                <h3 className="text-lg font-bold mb-2 leading-tight">
                  <a href={item.link} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {item.title}
                  </a>
                </h3>
                {item.enclosureUrl && (
                  <div className="mb-3">
                    {item.enclosureType?.startsWith('audio/') ? (
                      <audio controls className="w-full h-10">
                        <source src={item.enclosureUrl} type={item.enclosureType} />
                      </audio>
                    ) : item.enclosureType?.startsWith('video/') ? (
                      <video controls className="w-full rounded-lg">
                        <source src={item.enclosureUrl} type={item.enclosureType} />
                      </video>
                    ) : null}
                  </div>
                )}
                <div className="text-sm text-zinc-600 dark:text-zinc-400 line-clamp-3 mb-3">
                  <Markdown content={item.content || ''} />
                </div>
                <div className="flex justify-between items-center text-xs text-zinc-500">
                  <span>{item.author || selectedFeed.title}</span>
                  <span>{item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ''}</span>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};
