/** Community shared library — realtime feed of link-imported tracks. */
import { useEffect, useState } from 'react';
import { subscribeSharedTracks, type SharedTrack } from '@/lib/sync/sharedLibrary';

export function useSharedTracks(): SharedTrack[] {
  const [items, setItems] = useState<SharedTrack[]>([]);
  useEffect(() => subscribeSharedTracks(setItems), []);
  return items;
}
