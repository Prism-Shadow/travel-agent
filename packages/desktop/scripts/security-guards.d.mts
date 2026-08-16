/**
 * Types for `security-guards.mjs` — the guard runs as plain node in CI, but the unit test and any
 * TypeScript caller get a checked surface. Kept beside the implementation so the two move together.
 */
export interface DebugSwitchFinding {
  path: string;
  line: number;
  switch: string;
  text: string;
}

export interface ScannedFile {
  path: string;
  content: string;
}

export interface FuseMismatch {
  fuse: string;
  expected: boolean;
  actual: boolean | null | "absent";
}

export declare const DANGEROUS_SWITCHES: readonly string[];
export declare const ALLOW_MARKER: string;
export declare const EXPECTED_FUSES: Readonly<Record<string, boolean>>;
export declare const FUSE_INDEX: Readonly<Record<string, string>>;

export declare function matchesSwitch(
  line: string,
  switchName: string,
  options?: { apiOnly?: boolean },
): boolean;

export declare function scanForDebugSwitches(
  files: readonly ScannedFile[],
  options?: { apiOnly?: boolean },
): DebugSwitchFinding[];

export declare function interpretFuseWire(
  wire: Record<string | number, number | string>,
): Record<string, boolean | null>;

export declare function diffFuses(actual: Record<string, boolean | null>): FuseMismatch[];
