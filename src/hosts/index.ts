import { catbox } from './catbox';
import { gofile } from './gofile';
import type { Destination, DestinationId } from './types';

export const destinations: Destination[] = [gofile, catbox];

export function destinationById(id: string): Destination | undefined {
  return destinations.find((d) => d.id === id);
}

export const DEFAULT_DESTINATIONS: DestinationId[] = ['gofile', 'catbox'];
