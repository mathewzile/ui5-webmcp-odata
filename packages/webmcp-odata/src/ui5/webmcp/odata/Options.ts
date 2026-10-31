export type EntityOperation = "query" | "get" | "create" | "update" | "delete";

export interface EntitySetOptions {
  /** Restrict the generated CRUD tools for this set; metadata restrictions still apply on top. */
  operations?: EntityOperation[];
  /** Skip bound/unbound operations of this set */
  skipOperations?: boolean;
}

export interface WebMCPOptions {
  /** Only these entity sets get tools (default: all) */
  include?: string[];
  /** Entity sets that never get tools */
  exclude?: string[];
  /** Per entity set overrides */
  entitySets?: Record<string, EntitySetOptions>;
  /** Prefix for every tool name, e.g. "bookshop." */
  toolPrefix?: string;
  /** Upper bound for `top` in query tools (default 50) */
  maxTop?: number;
  /** Ask the user to confirm deletes in the UI (default true) */
  confirmDestructive?: boolean;
  /** Origins allowed to call the tools, passed to registerTool */
  exposedTo?: string[];
}

export const DEFAULT_OPTIONS: Required<
  Pick<WebMCPOptions, "toolPrefix" | "maxTop" | "confirmDestructive">
> = {
  toolPrefix: "",
  maxTop: 50,
  confirmDestructive: true,
};
