// postject 1.0.0-alpha.6 ships no types; this is the one function the packaging script calls
// (node_modules/postject/dist/api.js).
declare module 'postject' {
  export function inject(
    filename: string,
    resourceName: string,
    resourceData: Buffer,
    options?: { sentinelFuse?: string; machoSegmentName?: string; overwrite?: boolean },
  ): Promise<void>;
}
