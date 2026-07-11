import { env } from '../../config/index.js';
import { LocalDiskStorage } from './LocalDiskStorage.js';
import { R2Storage } from './R2Storage.js';
import type { StorageProvider } from './StorageProvider.js';

let instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!instance) {
    switch (env.STORAGE_DRIVER) {
      case 'local':
        instance = new LocalDiskStorage();
        break;
      case 'r2':
      case 's3':
        instance = new R2Storage();
        break;
      case 'supabase':
        // Supabase Storage is documented as a drop-in alt — not implemented yet.
        throw new Error('STORAGE_DRIVER=supabase is not implemented; use "r2" or "local"');
    }
  }
  return instance;
}

export type { StorageProvider } from './StorageProvider.js';
export { readToBuffer } from './StorageProvider.js';
export { LocalDiskStorage } from './LocalDiskStorage.js';
export { R2Storage } from './R2Storage.js';
