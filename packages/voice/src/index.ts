// The streaming speech and reply adapters of live voice (BLUEPRINT §9.2, docs/03-roadmap-appendix/
// phase2.md §5.3 and §7.5) and the vendor HTTP plumbing, shared by the web app and the voice worker.
// Plain Node `fetch` and `WebSocket` only: no database, domain or framework import (AGENTS.md §3).
export * from './http';
export * from './ports';
export * from './socket';
export * from './vendor-json';
export * from './roman-script';
export * from './sarvam';
export * from './claude-stream';
export * from './latency';
export * from './recorded';
export * from './recording';
