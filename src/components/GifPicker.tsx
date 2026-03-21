import React, { useState, useEffect } from 'react';
import { Block, Searchbar, Button } from 'konsta/react';

interface TenorGif {
  id: string;
  title: string;
  media_formats: {
    tinygif: { url: string; dims: [number, number]; size: number };
    gif: { url: string; dims: [number, number]; size: number };
  };
  url: string;
}

interface GifPickerProps {
  onSelect: (gif: TenorGif) => void;
  onClose: () => void;
}

const TENOR_API_KEY = import.meta.env.VITE_TENOR_API_KEY || 'LIVDSRZULELA';
const CLIENT_KEY = import.meta.env.VITE_TENOR_CLIENT_KEY || 'paper-atproto';

export const GifPicker: React.FC<GifPickerProps> = ({ onSelect, onClose }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [gifs, setGifs] = useState<TenorGif[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchGifs = async (query: string) => {
    setLoading(true);
    try {
      const endpoint = query 
        ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${TENOR_API_KEY}&client_key=${CLIENT_KEY}&limit=20`
        : `https://tenor.googleapis.com/v2/featured?key=${TENOR_API_KEY}&client_key=${CLIENT_KEY}&limit=20`;
      
      const response = await fetch(endpoint);
      const data = await response.json();
      setGifs(data.results || []);
    } catch (error) {
      console.error('Error fetching GIFs from Tenor:', error);
    } finally {
      setLoading(false);
    }
  };

  // Debounce search to avoid excessive API calls
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchQuery.length > 2 || searchQuery.length === 0) {
        fetchGifs(searchQuery);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleSearch = (e: any) => {
    setSearchQuery(e.target.value);
  };

  return (
    <div className="fixed inset-0 z-50 bg-white dark:bg-black flex flex-col">
      <div className="p-4 flex justify-between items-center border-b dark:border-zinc-800">
        <h2 className="text-lg font-bold">Select a GIF</h2>
        <Button onClick={onClose} clear inline>Cancel</Button>
      </div>
      
      <Searchbar
        placeholder="Search Tenor"
        value={searchQuery}
        onInput={handleSearch}
        onClear={() => { setSearchQuery(''); fetchGifs(''); }}
      />

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center p-10 text-zinc-500">Loading GIFs...</div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {gifs.map((gif) => (
              <div 
                key={gif.id} 
                className="aspect-square overflow-hidden rounded-lg cursor-pointer active:opacity-70 transition-opacity"
                onClick={() => onSelect(gif)}
              >
                <img 
                  src={gif.media_formats.tinygif.url} 
                  alt={gif.title} 
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              </div>
            ))}
          </div>
        )}
      </div>
      
      <Block className="text-center text-xs text-zinc-400 py-2">
        Powered by Tenor
      </Block>
    </div>
  );
};
