import { EventEmitter } from 'node:events';

/** Domain events emitted by services. Handlers must never throw upstream. */
export interface DomainEvents {
  'track.processed': { trackId: string; uploadId: string; userId: string; title: string };
  'upload.failed': { uploadId: string; userId: string; error: string };
  'play.recorded': { userId: string; trackId: string; trackTitle: string; completed: boolean };
  'track.liked': { userId: string; trackId: string; trackTitle: string };
  'playlist.created': { userId: string; playlistId: string; title: string };
  'artist.followed': { userId: string; artistId: string; artistName: string };
  'user.followed': { followerId: string; followeeId: string; followeeName: string };
}

export type DomainEventName = keyof DomainEvents;

type Handler<K extends DomainEventName> = (payload: DomainEvents[K]) => void | Promise<void>;

class TypedEventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<K extends DomainEventName>(event: K, handler: Handler<K>): void {
    this.emitter.on(event, (payload: DomainEvents[K]) => {
      // Isolate handler failures — domain side effects must not break requests.
      Promise.resolve(handler(payload)).catch(() => undefined);
    });
  }

  emit<K extends DomainEventName>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  removeAll(event?: DomainEventName): void {
    this.emitter.removeAllListeners(event);
  }
}

export const eventBus = new TypedEventBus();
