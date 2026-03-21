import React, { useState, useEffect } from 'react';
import { App, Page, Navbar, Block, List, ListItem, Searchbar } from 'konsta/react';
import { FeedItem } from './components/FeedItem';
import { GestureView } from './components/GestureView';
import { Markdown } from './components/Markdown';
import { GifPicker } from './components/GifPicker';
import { Gif } from './components/Gif';
import { Button } from 'konsta/react';
import { hybridSearch } from './search';
import { paperDB } from './db';

const PaperApp: React.FC = () => {
  const [posts, setPosts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [selectedGif, setSelectedGif] = useState<any>(null);

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
    const db = paperDB.getDB();
    const result = await db.query('SELECT * FROM posts ORDER BY created_at DESC LIMIT 20');
    setPosts(result.rows);
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      setIsSearching(true);
      const results = await hybridSearch.search(query);
      setPosts(results.rows);
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
          subtitle={isSearching ? 'Searching...' : 'Your Feed'}
          className="top-0 sticky"
          right={
            <Button clear inline onClick={() => setShowGifPicker(true)}>
              GIF
            </Button>
          }
        />

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
              }}
              onClick={() => setSelectedPost(post)}
            />
          ))}
        </div>

        {selectedPost && (
          <GestureView onDismiss={() => setSelectedPost(null)}>
            <Navbar
              title="Post Detail"
              left={
                <a onClick={() => setSelectedPost(null)} className="link cursor-pointer">
                  Close
                </a>
              }
            />
            <Block className="mt-8">
              <div className="flex items-center mb-6">
                <div className="w-12 h-12 rounded-full bg-zinc-200 dark:bg-zinc-700 mr-4 flex items-center justify-center">
                  <span className="text-zinc-500 font-bold">
                    {selectedPost.author_did[0].toUpperCase()}
                  </span>
                </div>
                <div>
                  <div className="font-bold text-lg dark:text-white">
                    {selectedPost.author_did}
                  </div>
                  <div className="text-sm text-zinc-500">
                    {new Date(selectedPost.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
              <div className="text-xl leading-relaxed dark:text-zinc-200">
                <Markdown content={selectedPost.content} />
              </div>
              {selectedPost.embed?.type === 'app.bsky.embed.external' && selectedPost.embed.external.uri.includes('tenor.com') && (
                <Gif 
                  url={selectedPost.embed.external.uri} 
                  title={selectedPost.embed.external.title} 
                  thumbnail={selectedPost.embed.external.thumb} 
                />
              )}
            </Block>
            <Block className="text-center text-zinc-400 text-sm mt-20">
              Swipe down to dismiss
            </Block>
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
