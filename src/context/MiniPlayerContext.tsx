import React, { createContext, useContext, useState } from 'react';

export interface MiniPlayerEntry {
  url: string;
  thumb?: string;
  aspectRatio: number;
  startTime: number;
  /** ID of the post this video belongs to, for future scroll-back support */
  postId: string;
}

interface MiniPlayerContextValue {
  entry: MiniPlayerEntry | null;
  activate: (entry: MiniPlayerEntry) => void;
  dismiss: () => void;
}

const MiniPlayerContext = createContext<MiniPlayerContextValue | null>(null);

export function MiniPlayerProvider({ children }: { children: React.ReactNode }) {
  const [entry, setEntry] = useState<MiniPlayerEntry | null>(null);
  return (
    <MiniPlayerContext.Provider value={{
      entry,
      activate: setEntry,
      dismiss: () => setEntry(null),
    }}>
      {children}
    </MiniPlayerContext.Provider>
  );
}

export function useMiniPlayer() {
  const ctx = useContext(MiniPlayerContext);
  if (!ctx) throw new Error('useMiniPlayer must be used within MiniPlayerProvider');
  return ctx;
}
