import MessageToast from "sap/m/MessageToast";
import ODataUtils from "sap/ui/model/odata/v4/ODataUtils";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type { HierarchyDescriptor } from "../metadata/Capabilities";
import {
  hierarchyQuery,
  moveProblem,
  type HierarchyMode,
} from "../metadata/HierarchyQuery";
import { objectSchema, propertySchema, type JsonSchema } from "../metadata/JsonSchema";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import { throwIfAborted } from "../runtime/Abort";
import { refreshBindings, staleInfo } from "../runtime/BindingRefresher";
import { clean, entityPath, userKeyNames } from "../runtime/Keys";
import { failure, success } from "../runtime/Result";
import { declinedWrite, guarded, type ToolSettings } from "./EntitySetTools";
import { text } from "../runtime/I18n";

type Input = Record<string, unknown>;

/** The hierarchy tools need the node value to be the only key; draft sets are not supported */
function usableHierarchy(set: EntitySetDescriptor): HierarchyDescriptor | undefined {
  const hierarchy = set.hierarchies[0];
  const keys = userKeyNames(set);
  return hierarchy &&
    hierarchy.parentKey &&
    !set.draft &&
    keys.length === 1 &&
    keys[0] === hierarchy.nodeProperty
    ? hierarchy
    : undefined;
}

/**
 * `<Set>.hierarchy` reads a recursive hierarchy (CAP `@hierarchy`), `<Set>.move` changes
 * the parent of a node.
 */
export function createHierarchyTools(
  model: ODataModel,
  set: EntitySetDescriptor,
  settings: ToolSettings & { maxHierarchyNodes: number },
  canMove: boolean,
): WebMCP.ModelContextTool[] {
  const hierarchy = usableHierarchy(set);
  if (!hierarchy || !set.readable) {
    return [];
  }
  const nodeProperty = set.properties.find((prop) => prop.name === hierarchy.nodeProperty)!;
  const literal = (value: unknown) =>
    ODataUtils.formatLiteral(value as string, nodeProperty.edmType);
  const nodeSchema: JsonSchema = {
    ...propertySchema({ ...nodeProperty, nullable: false }),
    description: `Value of ${hierarchy.nodeProperty} of the node`,
  };
  const subject = set.label ?? set.name;
  const name = (operation: string) => `${settings.toolPrefix}${set.name}.${operation}`;
  const tools: WebMCP.ModelContextTool[] = [];

  tools.push({
    name: name("hierarchy"),
    title: `Read the ${subject} hierarchy`,
    description: `Reads the ${subject} (${set.name}) tree. Modes: roots (top level nodes), children (direct children of 'node'), descendants (the nodes up to 'depth' levels below 'node'), ancestors (path from the root down to the parent of 'node'), tree (all nodes down to 'depth' levels). Tree and descendant rows carry DrillState (leaf, collapsed, expanded) and DistanceFromRoot.`,
    inputSchema: objectSchema(
      {
        mode: {
          type: "string",
          enum: ["roots", "children", "descendants", "ancestors", "tree"],
        },
        node: nodeSchema,
        depth: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Levels for tree (default 2) and descendants (default 1)",
        },
      },
      ["mode"],
    ),
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: guarded(async (input: Input) => {
      const mode = input.mode as HierarchyMode;
      const node = input.node;
      if (["children", "descendants", "ancestors"].includes(mode) && node === undefined) {
        return failure(new Error(`The mode ${mode} needs 'node'`), "invalidInput");
      }
      if (mode === "ancestors") {
        return success(
          (await ancestors(model, set, hierarchy, node, settings.maxHierarchyNodes)).map(
            (row) => tidy(row, hierarchy),
          ),
        );
      }
      const depth = (input.depth as number | undefined) ?? (mode === "tree" ? 2 : 1);
      let query;
      try {
        query = hierarchyQuery(mode, set.name, hierarchy, {
          nodeLiteral: node === undefined ? undefined : literal(node),
          depth,
        });
      } catch (error) {
        return failure(error, "invalidInput");
      }
      const list = model.bindList(`/${set.name}`, undefined, undefined, undefined, {
        $count: true,
        ...(query.apply
          ? { $apply: query.apply }
          : { $filter: query.filter, $orderby: hierarchy.nodeProperty }),
      });
      try {
        const contexts = await list.requestContexts(0, settings.maxTop);
        const count = list.getCount();
        const rows = contexts.map((context) => tidy(clean(context.getObject()) as Input, hierarchy));
        return success(rows, {
          count,
          hasMore: count === undefined ? rows.length === settings.maxTop : rows.length < count,
        });
      } finally {
        list.destroy();
      }
    }),
  });

  if (canMove && set.updatable) {
    tools.push({
      name: name("move"),
      title: `Move a ${subject} node`,
      description: `Moves a ${subject} (${set.name}) node, with everything below it, to a new parent. The parent must not be the node itself or one of its descendants.`,
      inputSchema: objectSchema(
        {
          node: nodeSchema,
          parent: {
            ...nodeSchema,
            type: [nodeSchema.type as string, "null"],
            description: `Value of ${hierarchy.nodeProperty} of the new parent, or null to make the node a root`,
          },
        },
        ["node", "parent"],
      ),
      annotations: {},
      execute: guarded(async (input: Input, signal) => {
        const node = String(input.node);
        const parent = input.parent === null ? null : String(input.parent);
        // Context#move works on a hierarchy binding, so the nodes have to be in its collection
        // Only the node and parent keys are needed; without an explicit $select UI5 1.154 fails
        // to build the key predicates of a hierarchy binding
        const list = model.bindList(`/${set.name}`, undefined, undefined, undefined, {
          $select: [hierarchy.nodeProperty, hierarchy.parentKey!],
          $$aggregation: {
            hierarchyQualifier: hierarchy.qualifier,
            expandTo: Number.MAX_SAFE_INTEGER,
          },
        });
        try {
          const contexts = await list.requestContexts(0, settings.maxHierarchyNodes);
          const objects = contexts.map((context) => context.getObject() as Input);
          const find = (value: string) =>
            objects.findIndex((object) => String(object[hierarchy.nodeProperty]) === value);
          const nodeIndex = find(node);
          const parentIndex = parent === null ? -1 : find(parent);
          if (nodeIndex < 0 || (parent !== null && parentIndex < 0)) {
            const complete = contexts.length < settings.maxHierarchyNodes;
            return failure(
              new Error(
                complete
                  ? `${nodeIndex < 0 ? `Node ${node}` : `Parent ${parent}`} does not exist`
                  : `The hierarchy has ${settings.maxHierarchyNodes} or more nodes, the node cannot be located (option maxHierarchyNodes)`,
              ),
              complete ? "notFound" : "hierarchyTooLarge",
            );
          }
          const parentOf = new Map(
            objects.map((object) => {
              const up = object[hierarchy.parentKey!];
              return [String(object[hierarchy.nodeProperty]), up == null ? null : String(up)];
            }),
          );
          const problem = moveProblem(node, parent, parentOf);
          if (problem) {
            return failure(
              new Error(
                problem === "self"
                  ? "A node cannot be its own parent"
                  : "A node cannot be moved below one of its own descendants",
              ),
              "invalidMove",
            );
          }
          if (await declinedWrite(settings, text("confirmMove", subject, node, parent ?? text("moveTopLevel")))) {
            return failure(new Error("The user declined the move"), "declined");
          }
          throwIfAborted(signal);
          await contexts[nodeIndex].move({
            parent: parent === null ? null : contexts[parentIndex],
          });
          const stale = staleInfo(refreshBindings(model, set.name));
          MessageToast.show(text("toastMoved", subject));
          return success(undefined, { key: { [hierarchy.nodeProperty]: node }, ...stale });
        } finally {
          list.destroy();
        }
      }),
    });
  }
  return tools;
}

/** Hierarchy columns the service does not fill are null; leave them out */
function tidy(row: Input, hierarchy: HierarchyDescriptor): Input {
  for (const column of Object.values(hierarchy.columns)) {
    if (row[column] === null) {
      delete row[column];
    }
  }
  return row;
}

/** Walks up the parent key, one request per level; root first, the node itself excluded */
async function ancestors(
  model: ODataModel,
  set: EntitySetDescriptor,
  hierarchy: HierarchyDescriptor,
  node: unknown,
  limit: number,
): Promise<Input[]> {
  const chain: Input[] = [];
  const read = async (value: unknown) => {
    const binding = model.bindContext(entityPath(set, { [hierarchy.nodeProperty]: value }));
    try {
      return (await binding.requestObject()) as Input | undefined;
    } finally {
      binding.destroy();
    }
  };
  let current = await read(node);
  if (!current) {
    throw new Error(`Node ${String(node)} does not exist`);
  }
  while (chain.length < limit) {
    const up = current[hierarchy.parentKey!];
    if (up === null || up === undefined) {
      break;
    }
    current = await read(up);
    if (!current) {
      break;
    }
    chain.unshift(clean(current) as Input);
  }
  return chain;
}
