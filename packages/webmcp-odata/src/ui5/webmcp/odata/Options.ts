export type EntityOperation = "query" | "get" | "create" | "update" | "delete";

export interface EntitySetOptions {
  /** Restrict the generated CRUD tools for this set; metadata restrictions still apply on top. */
  operations?: EntityOperation[];
  /** Skip bound/unbound operations of this set */
  skipOperations?: boolean;
}

export interface OperationFilter {
  /** Only these actions and functions get tools (default: all) */
  include?: string[];
  /** Actions and functions that never get tools */
  exclude?: string[];
}

/** Whether an action or function (by its name, not the qualified one) gets a tool */
export function operationAllowed(
  name: string,
  filter: OperationFilter | undefined,
): boolean {
  return (
    (!filter?.include || filter.include.includes(name)) &&
    !filter?.exclude?.includes(name)
  );
}

export interface WebMCPOptions {
  /** Narrow the tools for actions and functions, bound ones included */
  operations?: OperationFilter;
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
  /**
   * Largest size of a tool result in characters (default 50000, 0 = unlimited). A longer list
   * loses rows from the end and is marked `truncated`; a single entry that is too large fails.
   */
  maxResultChars?: number;
  /**
   * How many levels of compositions deep create and update reach (default 3), e.g. 3 for
   * Book → chapters → sections. Self-referencing compositions stop here as well.
   */
  maxCompositionDepth?: number;
  /**
   * Most nodes a move loads to find the node and its new parent (default 1000). Larger
   * hierarchies fail with `hierarchyTooLarge` instead of loading everything.
   */
  maxHierarchyNodes?: number;
  /** Most entries one batch call may create, update and delete together (default 50) */
  maxBatchItems?: number;
  /** Ask the user to confirm creates, updates, moves and batches in the UI (default false) */
  confirmWrites?: boolean;
  /** Ask the user before actions run: `true` for all, or the names of the actions (default false) */
  confirmActions?: boolean | string[];
  /**
   * `"perSet"` (default) registers tools per entity set and operation (`Books.query`).
   * `"generic"` registers one tool per operation (`entity.query`) that takes the entity set
   * as an argument, which keeps the tool list short for services with many entity sets.
   */
  toolMode?: "perSet" | "generic";
  /** Switches to the generic tools automatically when more entity sets than this get tools */
  genericThreshold?: number;
}

/**
 * Entity set names in the options that the service does not have. A typo in
 * `include`, `exclude` or `entitySets` would otherwise silently do nothing.
 */
export function unknownEntitySets(
  options: WebMCPOptions,
  known: string[],
): string[] {
  const mentioned = [
    ...(options.include ?? []),
    ...(options.exclude ?? []),
    ...Object.keys(options.entitySets ?? {}),
  ];
  return [...new Set(mentioned)].filter((name) => !known.includes(name));
}

export const DEFAULT_OPTIONS: Required<
  Pick<
    WebMCPOptions,
    | "toolPrefix"
    | "maxTop"
    | "confirmDestructive"
    | "maxResultChars"
    | "maxCompositionDepth"
    | "maxHierarchyNodes"
    | "maxBatchItems"
    | "confirmWrites"
    | "confirmActions"
  >
> = {
  toolPrefix: "",
  maxTop: 50,
  confirmDestructive: true,
  maxResultChars: 50_000,
  maxCompositionDepth: 3,
  maxHierarchyNodes: 1000,
  maxBatchItems: 50,
  confirmWrites: false,
  confirmActions: false,
};

/** Whether running the named action needs the user's confirmation */
export function actionNeedsConfirmation(
  name: string,
  setting: boolean | string[] | undefined,
): boolean {
  return Array.isArray(setting) ? setting.includes(name) : !!setting;
}
