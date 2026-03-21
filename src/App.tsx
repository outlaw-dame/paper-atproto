import React, { useState, useEffect } from 'react';
import { App, Page, Navbar, Block, List, ListItem, Searchbar } from 'konsta/react';
import { FeedItem } from './components/FeedItem';
import { GestureView } from './components/GestureView';
import { GifPicker } from './components/GifPicker';
import { Button, Toolbar, Link } from 'konsta/react';
import { hybridSearch } from './search';
import { paperDB } from './db';
import { fetchOGData } from './og';
import type { OGMetadata } from './og';
import { LinkPreview } from './components/LinkPreview';
import { FeedList } from './components/FeedList';

const PaperApp: React.FC = () => {
  const [posts, setPosts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [selectedGif, setSelectedGif] = useState<any>(null);
  const [previewLink, setPreviewLink] = useState<OGMetadata | null>(null);
  const [activeTab, setActiveTab] = useState<'timeline' | 'feeds'>('timeline');

  useEffect(() => {
    const init = async () => {
      await paperDB.init();
      await hybridSearch.init();
      loadPosts();
    };
    init();

    // Listen for hashtag clicks from the Markdown component
    const handleHashtagClick = (e: any) => {
      const tag = e.detail;
      handleSearch(`#${tag}`);
      // Close post detail if open
      setSelectedPost(null);
    };

    window.addEventListener('hashtag-click', handleHashtagClick);
    return () => window.removeEventListener('hashtag-click', handleHashtagClick);
  }, []);

  const loadPosts = async () => {
    const pg = paperDB.getPG();
    const result = await pg.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 20');
    const postsWithEntities = await Promise.all(
      result.rows.map(async (post: any) => {
        const entitiesResult = await pg.query('SELECT * FROM entities WHERE post_id = $1', [post.id]);
        return { ...post, entities: entitiesResult.rows };
      })
    );
    setPosts(postsWithEntities);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      setIsSearching(true);
      // Search across both posts and feed items using hybrid search
      const results = await hybridSearch.searchAll(query);
      setPosts(results.rows.map((row: any) => ({
        ...row,
        author_did: row.item_type === 'post' ? row.author_did || 'unknown' : 'feed',
        created_at: row.created_at || new Date().toISOString(),
      })));
    } else {
      setIsSearching(false);
      loadPosts();
    }
  };

  return (
    <App theme="ios">
      <Page>
        <Navbar
          title="Paper ATProto"
          subtitle={activeTab === 'timeline' ? (isSearching ? 'Searching...' : 'Your Feed') : 'News, Podcasts, Videos'}
          className="top-0 sticky"
          right={
            <Button clear inline onClick={() => setShowGifPicker(true)}>
              GIF
            </Button>
          }
        />

        {activeTab === 'timeline' ? (
          <>
            <Searchbar
              placeholder="Search posts semantically..."
              value={searchQuery}
              onInput={(e: any) => handleSearch(e.target.value)}
              onClear={() => handleSearch('')}
            />

            <div className="pb-20">
              {posts.map((post) => (
                <FeedItem
                  key={post.id}
                  post={{
                    id: post.id,
                    author: { handle: post.author_did.substring(0, 15) }, // Simplified for demo
                    content: post.content,
                    createdAt: post.created_at,
                    embed: post.embed,
                    entities: post.entities,
                  }}
                  onClick={() => setSelectedPost(post)}
                />
              ))}
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-hidden pb-20">
            <FeedList />
          </div>
        )}

        <Toolbar bottom className="ios:bg-zinc-100 dark:ios:bg-zinc-900 fixed bottom-0 w-full z-50">
          <Link 
            tabLink 
            tabLinkActive={activeTab === 'timeline'} 
            onClick={() => setActiveTab('timeline')}
          >
            Timeline
          </Link>
          <Link 
            tabLink 
            tabLinkActive={activeTab === 'feeds'} 
            onClick={() => setActiveTab('feeds')}
          >
            Feeds
          </Link>
        </Toolbar>

        {selectedPost && (
          <GestureView onDismiss={() => setSelectedPost(null)}>
            <Navbar
              title="Post Detail"
              left={
                <Link onClick={() => setSelectedPost(null)}>Close</Link>
              }
            />
            <div className="p-4">
              <FeedItem 
                post={{
                  id: selectedPost.id,
                  author: { handle: selectedPost.author_did.substring(0, 15) },
                  content: selectedPost.content,
                  createdAt: selectedPost.created_at,
                  embed: selectedPost.embed,
                  entities: selectedPost.entities,
                }}
              />
              <Block className="text-center text-zinc-400 text-sm mt-10">
                Swipe down to dismiss
              </Block>
            </div>
          </GestureView>
        )}

        {showGifPicker && (
          <GifPicker 
            onSelect={(gif) => {
              setSelectedGif(gif);
              setShowGifPicker(false);
            }} 
            onClose={() => setShowGifPicker(false)} 
          />
        )}

        {/* Link Preview Demo Trigger */}
        <div className="fixed bottom-20 right-4 z-40">
          <Button 
            clear 
            inline 
            className="bg-blue-500 text-white rounded-full p-3 shadow-lg"
            onClick={async () => {
              const url = prompt('Enter a URL to preview:');
              if (url) {
                const data = await fetchOGData(url);
                setPreviewLink(data);
              }
            }}
          >
            🔗
          </Button>
        </div>

        {previewLink && (
          <div className="fixed bottom-24 right-4 z-50 w-72 shadow-2xl rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border dark:border-zinc-800">
            <div className="relative">
              <LinkPreview {...previewLink} />
              <Button 
                clear 
                inline 
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1 z-10"
                onClick={() => setPreviewLink(null)}
              >
                ✕
              </Button>
            </div>
          </div>
        )}

        {selectedGif && (
          <div className="fixed bottom-4 right-4 z-40 w-48 shadow-2xl rounded-xl overflow-hidden bg-white dark:bg-zinc-900 border dark:border-zinc-800">
            <div className="relative">
              <img src={selectedGif.media_formats.tinygif.url} alt="Selected GIF" className="w-full h-auto" />
              <Button 
                clear 
                inline 
                className="absolute top-1 right-1 bg-black/50 text-white rounded-full p-1"
                onClick={() => setSelectedGif(null)}
              >
                ✕
              </Button>
            </div>
            <div className="p-2 text-xs text-center font-medium dark:text-white">Ready to post</div>
          </div>
        )}
      </Page>
    </App>
  );
};

export default PaperApp;
