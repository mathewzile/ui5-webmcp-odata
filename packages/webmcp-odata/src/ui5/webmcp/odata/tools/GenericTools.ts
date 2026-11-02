import type { JsonSchema } from "../metadata/JsonSchema";
import { objectSchema } from "../metadata/JsonSchema";
import { validate } from "../metadata/Validate";
import { failure, serialize } from "../runtime/Result";

/** A per-set tool and what it belongs to; the generic tools dispatch to these */
export interface SetTool {
  entitySet: string;
  /** `query`, `get`, `create`, `update`, `delete`, `batch`, `aggregate`, `hierarchy` or `move` */
  operation: string;
  tool: WebMCP.ModelContextTool;
}

const SUMMARIES: Record<string, string> = {
  query: "Reads entries with optional filter, sorting and paging",
  get: "Reads one entry by key",
  create: "Creates an entry, children included",
  update: "Changes an entry; lists of children replace the existing ones",
  delete: "Deletes an entry by key",
  batch: "Creates, updates and deletes several entries atomically",
  aggregate: "Groups entries and computes sums, averages, minimum, maximum or counts",
  hierarchy: "Reads a tree: roots, children, descendants, ancestors",
  move: "Moves a tree node to a new parent",
};

/** The input schemas of the per-set tools, by entity set and operation */
export function toolSchemas(
  entries: SetTool[],
): Record<string, Record<string, JsonSchema>> {
  const result: Record<string, Record<string, JsonSchema>> = {};
  for (const { entitySet, operation, tool } of entries) {
    (result[entitySet] ??= {})[operation] = (tool.inputSchema ?? objectSchema({})) as JsonSchema;
  }
  return result;
}

/**
 * Hints for the generic tool: it is read-only only if every tool behind it is, and it is
 * consequential or returns untrusted content if any of them does.
 */
function mergedAnnotations(tools: WebMCP.ModelContextTool[]): Record<string, boolean> {
  const all = tools.map((tool) => (tool.annotations ?? {}) as Record<string, boolean>);
  return {
    ...(all.every((hints) => hints.readOnlyHint) ? { readOnlyHint: true } : {}),
    ...(all.some((hints) => hints.consequentialHint) ? { consequentialHint: true } : {}),
    ...(all.some((hints) => hints.untrustedContentHint) ? { untrustedContentHint: true } : {}),
  };
}

/**
 * One tool per operation (`entity.query`, `entity.update` ...) in place of one per set and
 * operation, for services with many entity sets. The caller names the set and passes the
 * input of that set's tool as `arguments`, which is checked against the schema of that tool
 * before it runs; `app.describe_service` returns the schema.
 */
export function createGenericTools(
  entries: SetTool[],
  prefix: string,
): WebMCP.ModelContextTool[] {
  const operations = [...new Set(entries.map((entry) => entry.operation))];
  return operations.map((operation) => {
    const own = entries.filter((entry) => entry.operation === operation);
    const byName = new Map(own.map((entry) => [entry.entitySet, entry.tool]));
    return {
      name: `${prefix}entity.${operation}`,
      title: `${operation[0].toUpperCase()}${operation.slice(1)} entries of an entity set`,
      description: `${SUMMARIES[operation] ?? operation}. Name the entity set and pass the operation's input as 'arguments'; call app.describe_service with the entity set first to get the input schema of ${operation}. Entity sets: ${[...byName.keys()].join(", ")}.`,
      inputSchema: objectSchema(
        {
          entitySet: { type: "string", enum: [...byName.keys()] },
          arguments: {
            type: "object",
            description: `Input of ${operation} for that entity set, as app.describe_service gives it`,
          },
        },
        ["entitySet"],
      ),
      annotations: mergedAnnotations(own.map((entry) => entry.tool)),
      execute: async (input, options) => {
        const { entitySet, arguments: args = {} } = (input ?? {}) as {
          entitySet?: string;
          arguments?: Record<string, unknown>;
        };
        const tool = entitySet === undefined ? undefined : byName.get(entitySet);
        if (!tool) {
          return serialize(
            failure(
              new Error(
                `${operation} is not available for ${String(entitySet)}. Entity sets: ${[...byName.keys()].join(", ")}`,
              ),
              "invalidInput",
            ),
          );
        }
        const errors = validate((tool.inputSchema ?? {}) as JsonSchema, args, "arguments");
        if (errors.length) {
          return serialize(
            failure(new Error(`Invalid arguments for ${entitySet}: ${errors.join("; ")}`), "invalidInput"),
          );
        }
        return tool.execute(args, options);
      },
    };
  });
}
