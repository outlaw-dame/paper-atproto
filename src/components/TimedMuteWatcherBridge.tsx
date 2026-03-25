import React from 'react';
import { useTimedMuteWatcher } from '../lib/atproto/useTimedMuteWatcher.js';

// Mounted lazily from AppShell to keep ATProto watcher logic out of the
// initial synchronous startup import path.
export default function TimedMuteWatcherBridge() {
  useTimedMuteWatcher();
  return null;
}
