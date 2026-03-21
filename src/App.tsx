import React, { useState, useEffect } from 'react';
import { App, Page, Navbar, Block, List, ListItem, Searchbar } from 'konsta/react';
import { FeedItem } from './components/FeedItem';
import { GestureView } from './components/GestureView';
import { hybridSearch } from './search';
import { paperDB } from './db';

const PaperApp: React.FC = () => {
  const [posts, setPosts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPost, setSelectedPost] = useState<any | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const init = async () => {
      await paperDB.init();
      await hybridSearch.init();
      loadPosts();
    };
    init();
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
              <p className="text-xl leading-relaxed dark:text-zinc-200">
                {selectedPost.content}
              </p>
            </Block>
            <Block className="text-center text-zinc-400 text-sm mt-20">
              Swipe down to dismiss
            </Block>
          </GestureView>
        )}
      </Page>
    </App>
  );
};

export default PaperApp;
