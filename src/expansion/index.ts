import type { Dataset } from '../data/registry';
import snes from '../data/expansion/snes.json';
import sow from '../data/expansion/sow.json';
import type { SnesClass, SowClass } from './sources';
import { expandDataset } from './translate';

/** `d` with the SNES Ogre Battle and Symphony of War classes grafted on. */
export function withExpansion(d: Dataset): Dataset {
  return expandDataset(d, snes as unknown as SnesClass[], sow as unknown as SowClass[]).dataset;
}
