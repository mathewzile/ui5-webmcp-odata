import type Context from "sap/ui/model/odata/v4/Context";
import type { ODataListBinding$CreateCompletedEvent } from "sap/ui/model/odata/v4/ODataListBinding";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import { changeableProperties, createProperties } from "../metadata/Writable";
import { queueDeepChanges, type Queued } from "./DeepApply";
import { childPayload, expandFor } from "./DeepPayload";
import { etagMismatch } from "./Etag";
import { flattenChanges } from "./Flatten";
import { entityPath, pick } from "./Keys";

type Input = Record<string, unknown>;

/** A 412 for `reasonOf`: the entry changed after the caller read it */
function staleEtagError(): Error & { status: number } {
  return Object.assign(
    new Error("The entry was changed by someone else after you read it, nothing was saved."),
    { status: 412 },
  );
}

/** Body to create an entry: allowed properties, children, and active data for draft sets */
export function createPayload(set: EntitySetDescriptor, input: Input): Input {
  const payload = pick(input, createProperties(set).map((prop) => prop.name));
  for (const composition of set.compositions) {
    if (input[composition.name] !== undefined) {
      payload[composition.name] = childPayload(composition, input[composition.name]);
    }
  }
  if (set.draft) {
    // Create the active instance directly (draft bypass)
    payload.IsActiveEntity = true;
  }
  return payload;
}

/**
 * Opens a list binding in the group and returns the function that queues a creation.
 * Nothing is sent before the caller submits the group. UI5 repeats a failed creation for
 * ever, so each creation is tracked in `queue.created` through `createCompleted`.
 */
export function openCreates(
  model: ODataModel,
  set: EntitySetDescriptor,
  groupId: string,
  queue: Queued,
): (input: Input) => Context {
  const list = model.bindList(`/${set.name}`, undefined, undefined, undefined, {
    $$updateGroupId: groupId,
  });
  queue.bindings.push(list);
  const waiting: ((success: boolean) => void)[] = [];
  list.attachCreateCompleted((event: ODataListBinding$CreateCompletedEvent) => {
    waiting.shift()?.(!!event.getParameter("success"));
  });
  return (input) => {
    queue.created.push(new Promise<boolean>((resolve) => waiting.push(resolve)));
    const context = list.create(createPayload(set, input));
    // Resetting a failed group cancels the creation and rejects `created()`. The callers look at
    // the outcome through `queue.created`, so this keeps the rejection from being reported as unhandled.
    context.created()?.catch(() => undefined);
    return context;
  };
}

/**
 * Loads the entry, checks its ETag and queues the changes, children included. The entry's
 * binding stays in `queue.bindings`; its context is returned to read the result after the submit.
 */
export async function queueUpdate(
  model: ODataModel,
  set: EntitySetDescriptor,
  input: Input,
  groupId: string,
  queue: Queued,
): Promise<Context> {
  const changes = (input.changes ?? {}) as Input;
  const expand = expandFor(set.compositions, changes);
  const binding = model.bindContext(entityPath(set, input), undefined, {
    $$updateGroupId: groupId,
    ...(expand ? { $expand: expand } : {}),
  });
  queue.bindings.push(binding);
  // The entity (and its ETag) must be loaded before properties can be set
  const current = await binding.requestObject();
  if (etagMismatch(input.etag, current)) {
    throw staleEtagError();
  }
  const context = binding.getBoundContext();
  const changeable = changeableProperties(set);
  // `setProperty` changes one primitive property: complex values become paths (address/street)
  const flat = flattenChanges(
    pick(changes, changeable.map((prop) => prop.name)),
    changeable.filter((prop) => prop.complexProperties).map((prop) => prop.name),
  );
  for (const [name, value] of Object.entries(flat)) {
    queue.pending.push(context.setProperty(name, value));
  }
  // Children of all levels are queued in the same group: one atomic batch
  await queueDeepChanges(model, context, set.compositions, changes, groupId, queue);
  return context;
}

/** Loads the entry, checks its ETag and queues its deletion */
export async function queueDelete(
  model: ODataModel,
  set: EntitySetDescriptor,
  input: Input,
  groupId: string,
  queue: Queued,
): Promise<void> {
  const binding = model.bindContext(entityPath(set, input));
  queue.bindings.push(binding);
  const current = await binding.requestObject();
  if (etagMismatch(input.etag, current)) {
    throw staleEtagError();
  }
  queue.pending.push(binding.getBoundContext().delete(groupId));
  queue.deleted += 1;
}
