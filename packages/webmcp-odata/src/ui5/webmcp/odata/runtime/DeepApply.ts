import type Context from "sap/ui/model/odata/v4/Context";
import type { ODataListBinding$CreateCompletedEvent } from "sap/ui/model/odata/v4/ODataListBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type { CompositionDescriptor } from "../metadata/ServiceIntrospector";
import { diffChildren } from "./DeepDiff";
import { childKeyNames, childPayload, childProperties } from "./DeepPayload";
import { flattenChanges } from "./Flatten";

type Input = Record<string, unknown>;

/** Largest number of children per parent that an update compares against */
const MAX_CHILDREN = 1000;

/** What an update has queued in its group, to wait for after `submitBatch` */
export interface Queued {
  /** Changes and deletions: settle when the batch is done */
  pending: Promise<unknown>[];
  /** One entry per created child: whether the POST succeeded */
  created: Promise<boolean>[];
  /** Bindings to destroy at the end */
  bindings: { destroy(): void }[];
  /** Number of children the update deletes, so the user can be asked first */
  deleted: number;
}

export function newQueue(): Queued {
  return { pending: [], created: [], bindings: [], deleted: 0 };
}

/**
 * Queues the changes that turn the children of `parent` into `desired`, down all levels the
 * input mentions. Nothing is sent: the caller submits the group, so all levels go in one batch.
 * Children missing from a list are deleted, as in a deep PATCH of CAP.
 */
export async function queueDeepChanges(
  model: ODataModel,
  parent: Context,
  compositions: CompositionDescriptor[],
  desired: Input,
  groupId: string,
  queue: Queued,
): Promise<void> {
  for (const composition of compositions) {
    const value = desired[composition.name];
    if (value === undefined) {
      continue;
    }
    if (value === null && !composition.isCollection) {
      await queueDeleteSingle(model, parent, composition, groupId, queue);
    } else if (composition.isCollection) {
      await queueCollection(model, parent, composition, value as Input[], groupId, queue);
    } else {
      await queueSingle(model, parent, composition, value as Input, groupId, queue);
    }
  }
}

function changeProperties(
  composition: CompositionDescriptor,
  context: Context,
  changes: Input,
  groupId: string,
  queue: Queued,
): void {
  const complex = childProperties(composition)
    .filter((prop) => prop.complexProperties)
    .map((prop) => prop.name);
  for (const [name, value] of Object.entries(flattenChanges(changes, complex))) {
    queue.pending.push(context.setProperty(name, value, groupId));
  }
}

function propertyNames(composition: CompositionDescriptor): string[] {
  return childProperties(composition)
    .filter((prop) => !childKeyNames(composition).includes(prop.name))
    .map((prop) => prop.name);
}

async function queueCollection(
  model: ODataModel,
  parent: Context,
  composition: CompositionDescriptor,
  entries: Input[],
  groupId: string,
  queue: Queued,
): Promise<void> {
  const list = model.bindList(
    composition.name,
    parent,
    undefined,
    undefined,
    { $$updateGroupId: groupId },
  );
  queue.bindings.push(list);
  const contexts = await list.requestContexts(0, MAX_CHILDREN);
  if (contexts.length >= MAX_CHILDREN) {
    throw new Error(
      `${composition.name} has ${MAX_CHILDREN} or more entries, too many to compare with the new list`,
    );
  }
  const existing = contexts.map((context) => context.getObject() as Input);
  const diff = diffChildren(
    childKeyNames(composition),
    propertyNames(composition),
    existing,
    entries,
  );

  for (const update of diff.updates) {
    const context = contexts[update.index];
    changeProperties(composition, context, update.changes, groupId, queue);
    await queueDeepChanges(
      model,
      context,
      composition.compositions,
      update.desired,
      groupId,
      queue,
    );
  }
  queue.deleted += diff.deletes.length;
  for (const index of diff.deletes) {
    queue.pending.push(contexts[index].delete(groupId));
  }
  if (diff.creates.length) {
    // Fires per created entry, in order, for success and failure alike
    const waiting: ((success: boolean) => void)[] = [];
    list.attachCreateCompleted((event: ODataListBinding$CreateCompletedEvent) => {
      waiting.shift()?.(!!event.getParameter("success"));
    });
    for (const entry of diff.creates) {
      queue.created.push(new Promise<boolean>((resolve) => waiting.push(resolve)));
      // No bSkipRefresh, see the create tool
      list.create(childPayload(composition, entry) as Input);
    }
  }
}

async function queueSingle(
  model: ODataModel,
  parent: Context,
  composition: CompositionDescriptor,
  entry: Input,
  groupId: string,
  queue: Queued,
): Promise<void> {
  const binding = model.bindContext(composition.name, parent, {
    $$updateGroupId: groupId,
  });
  queue.bindings.push(binding);
  const current = await binding.requestObject();
  if (!current) {
    throw new Error(
      `${composition.name} does not exist yet; it cannot be created by an update, only changed`,
    );
  }
  const context = binding.getBoundContext();
  const changes: Input = {};
  for (const name of propertyNames(composition)) {
    if (entry[name] !== undefined) {
      changes[name] = entry[name];
    }
  }
  changeProperties(composition, context, changes, groupId, queue);
  await queueDeepChanges(model, context, composition.compositions, entry, groupId, queue);
}

/** `null` for a to-one composition deletes the child, if there is one */
async function queueDeleteSingle(
  model: ODataModel,
  parent: Context,
  composition: CompositionDescriptor,
  groupId: string,
  queue: Queued,
): Promise<void> {
  const binding = model.bindContext(composition.name, parent, {
    $$updateGroupId: groupId,
  });
  queue.bindings.push(binding);
  if (await binding.requestObject()) {
    queue.deleted += 1;
    queue.pending.push(binding.getBoundContext().delete(groupId));
  }
}
