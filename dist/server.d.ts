/**
 * The computer-use server: session state, the dispatcher, and the MCP wiring.
 *
 * Structure follows the official package: tools.ts owns the schemas, this file
 * owns execution. Every input action passes through `guard()` exactly once, so
 * there is a single place where the frontmost-app gate and the key blocklist
 * are enforced - including per-action inside computer_batch.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { type AttachedDisplay } from './display.js';
import { type ScreenshotDims } from './coords.js';
import type { InstalledApp } from './types.js';
import { type SessionState } from './policy.js';
export interface ServerContext {
    displays: AttachedDisplay[];
    activeDisplayIndex: number;
    session: SessionState;
    /** Pixel space of the last full screenshot - the basis for ALL coordinates. */
    lastScreenshot: {
        png: Buffer;
        dims: ScreenshotDims;
    } | null;
    installed: InstalledApp[];
    installedNames: string[];
}
/** MCP content blocks we emit. Typed explicitly so a mixed text+image result
 * is expressible without fighting literal inference at every return site. */
export type ContentBlock = {
    type: 'text';
    text: string;
} | {
    type: 'image';
    data: string;
    mimeType: string;
};
export interface ToolResult {
    content: ContentBlock[];
    isError?: boolean;
}
export declare function dispatch(ctx: ServerContext, name: string, args: Record<string, unknown>): Promise<ToolResult>;
export declare function createServer(): Promise<{
    server: Server;
    ctx: ServerContext;
}>;
export declare function main(): Promise<void>;
//# sourceMappingURL=server.d.ts.map