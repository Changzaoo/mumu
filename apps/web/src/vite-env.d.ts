/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** API base, e.g. http://localhost:4000/api/v1 (defaults to /api/v1 when unset). */
  readonly VITE_API_URL?: string;
  /** socket.io origin, e.g. http://localhost:4000. */
  readonly VITE_WS_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
