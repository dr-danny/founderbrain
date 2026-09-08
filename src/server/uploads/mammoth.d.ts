/**
 * src/server/uploads/mammoth.d.ts
 *
 * WHAT THIS IS. A minimal type declaration for the `mammoth` package, which ships no
 * types of its own and has no @types package on the registry.
 *
 * WHY IT EXISTS. Without this, `import ... from 'mammoth'` is a TypeScript error
 * (TS7016, no declaration file found), and the alternative is `any` scattered through
 * extract.ts or a suppressed error comment. Neither is worth it for the one function
 * this module actually calls. Only that function, and only the shape of what it
 * returns, is declared here — not the rest of mammoth's surface.
 *
 * WHAT CALLS IT. extract.ts, via `convertToMarkdown({ buffer })`.
 */
declare module 'mammoth' {
  export interface MammothMessage {
    readonly type: string;
    readonly message: string;
  }

  export interface MammothResult {
    readonly value: string;
    readonly messages: readonly MammothMessage[];
  }

  export function convertToMarkdown(input: { buffer: Buffer }): Promise<MammothResult>;
}
