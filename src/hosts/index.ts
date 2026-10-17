import { oauthHostsEnabled } from '@/features';
import { catbox } from './catbox';
import { gofile } from './gofile';
import { googledrive } from './googledrive';
import { pixeldrain } from './pixeldrain';
import type { Destination, DestinationId } from './types';
import { yandex } from './yandex';

/** Hosts that need EasyMirror registered with Google/Yandex (see src/features.ts). */
const OAUTH_HOSTS: Destination[] = [googledrive, yandex];

export const destinations: Destination[] = [
  gofile,
  catbox,
  pixeldrain,
  ...(oauthHostsEnabled(import.meta.env.MODE) ? OAUTH_HOSTS : []),
];

export function destinationById(id: string): Destination | undefined {
  return destinations.find((d) => d.id === id);
}

export const DEFAULT_DESTINATIONS: DestinationId[] = ['gofile', 'catbox'];
