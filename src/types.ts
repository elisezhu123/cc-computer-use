/**
 * Shared vocabulary. Deliberately thin: the tool schemas in tools.ts are plain
 * JSON-Schema literals matching the official server, so there is no zod layer
 * to translate through and no chance of the two drifting.
 */

export type CoordinateMode = 'pixels' | 'normalized_0_100';

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export interface InstalledApp {
  bundleId: string;
  displayName: string;
  path: string;
}

export interface RunningApp {
  bundleId: string;
  displayName: string;
  isFrontmost: boolean;
}

/** Error kinds the dispatcher reports, mirroring the official CuErrorKind. */
export type CuErrorKind =
  | 'needs_access'
  | 'not_granted'
  | 'denied_tier'
  | 'needs_flag'
  | 'bad_request'
  | 'platform'
  | 'internal';
