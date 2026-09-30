// Type surface for the version transition table the release pipeline reads. The
// implementation is plain JavaScript; only the exports are described.
export type ReleaseKind = "major" | "minor" | "patch" | "alpha" | "beta" | "rc" | "stable";

export type VersionParts = {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly preid: string | null;
  readonly counter: number;
};

export declare function parseVersion(version: string): VersionParts | null;
export declare function nextVersion(current: string, kinds: readonly string[]): string;
export declare function compareVersions(a: string, b: string): number;
