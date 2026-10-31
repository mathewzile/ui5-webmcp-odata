import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import type { EntitySetDescriptor } from "../metadata/ServiceIntrospector";
import type { ToolResult } from "./Result";
import { currentMessages } from "./Result";

interface DraftInfo {
  HasDraftEntity?: boolean;
  DraftAdministrativeData?: {
    InProcessByUser?: string;
    DraftIsCreatedByMe?: boolean;
    DraftIsProcessedByMe?: boolean;
    LastChangedByUser?: string;
    LastChangeDateTime?: string;
  } | null;
}

/**
 * Tools write active data directly (draft bypass) and never touch drafts.
 * Activating an existing draft later would overwrite our change, so writes to
 * a draft root that has a draft are refused. CAP rejects such writes as well
 * (409 DRAFT_ALREADY_EXISTS); checking first gives the agent a clear reason and
 * the draft owner, and protects against backends that do not.
 *
 * @param path absolute path of the active entity, including `IsActiveEntity=true`
 * @returns a failure result if a draft exists, otherwise undefined
 */
export async function checkNoDraft(
  model: ODataModel,
  set: EntitySetDescriptor,
  path: string,
): Promise<ToolResult | undefined> {
  // Only roots carry draft administration; child nodes are changed via their root
  if (!set.draftRoot) {
    return undefined;
  }
  const binding = model.bindContext(path, undefined, {
    $select: "HasDraftEntity",
    $expand:
      "DraftAdministrativeData($select=InProcessByUser,DraftIsCreatedByMe,DraftIsProcessedByMe,LastChangedByUser,LastChangeDateTime)",
  });
  let info: DraftInfo;
  try {
    info = ((await binding.requestObject()) ?? {}) as DraftInfo;
  } finally {
    binding.destroy();
  }
  if (!info.HasDraftEntity) {
    return undefined;
  }
  const admin = info.DraftAdministrativeData;
  return {
    ok: false,
    reason: "draftExists",
    error:
      `${set.name} has an unsaved draft${admin?.InProcessByUser ? ` locked by ${admin.InProcessByUser}` : ""}. ` +
      "Changing the active data now would be overwritten when the draft is activated. " +
      "Ask the user to activate or discard the draft in the UI first.",
    data: {
      draftIsMine: admin?.DraftIsCreatedByMe,
      lockedBy: admin?.InProcessByUser || undefined,
      lastChangedBy: admin?.LastChangedByUser,
      lastChange: admin?.LastChangeDateTime,
    },
    messages: currentMessages(),
  };
}
