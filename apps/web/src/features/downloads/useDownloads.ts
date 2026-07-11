import { useCallback, useSyncExternalStore } from 'react';
import {
  downloadStateOf,
  subscribeDownloadManager,
  type DownloadState,
} from './downloadManager';

const IDLE: DownloadState = { status: 'idle', progress: 0 };

/** Referentially-stable snapshots so useSyncExternalStore doesn't loop. */
const snapshots = new Map<string, DownloadState>();

export function useDownloadState(trackId: string): DownloadState {
  const getSnapshot = useCallback((): DownloadState => {
    const next = downloadStateOf(trackId);
    const prev = snapshots.get(trackId);
    if (prev && prev.status === next.status && prev.progress === next.progress) return prev;
    snapshots.set(trackId, next);
    return next;
  }, [trackId]);
  return useSyncExternalStore(subscribeDownloadManager, getSnapshot, () => IDLE);
}
