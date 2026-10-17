import { krakenfilesEnabled, oauthHostsEnabled } from '@/features';
import { buzzheavier } from './buzzheavier';
import { catbox } from './catbox';
import { gofile } from './gofile';
import { googledrive } from './googledrive';
import { krakenfiles } from './krakenfiles';
import { pixeldrain } from './pixeldrain';
import type { Destination, DestinationId } from './types';
import { vikingfile } from './vikingfile';
import { xfsDestinations } from './xfilesharing';
import { yandex } from './yandex';

/** Hosts that need EasyMirror registered with Google/Yandex (see src/features.ts). */
const OAUTH_HOSTS: Destination[] = [googledrive, yandex];

/** In display order: hosts that need no account first. */
export const destinations: Destination[] = [
  gofile,
  catbox,
  buzzheavier,
  vikingfile,
  ...(krakenfilesEnabled(import.meta.env.MODE) ? [krakenfiles] : []),
  pixeldrain,
  ...xfsDestinations,
  ...(oauthHostsEnabled(import.meta.env.MODE) ? OAUTH_HOSTS : []),
];

export function destinationById(id: string): Destination | undefined {
  return destinations.find((d) => d.id === id);
}

export const DEFAULT_DESTINATIONS: DestinationId[] = ['gofile', 'catbox'];
