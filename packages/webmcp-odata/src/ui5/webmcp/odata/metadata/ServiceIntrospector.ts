import type ODataMetaModel from "sap/ui/model/odata/v4/ODataMetaModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  TERM,
  annotationsOf,
  readDescription,
  readLabel,
  readSetCapabilities,
  type SetCapabilities,
} from "./Capabilities";

export interface PropertyDescriptor {
  name: string;
  edmType: string;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  isKey: boolean;
  /** Set by the server and never accepted from clients */
  computed: boolean;
  /** Server generates a value if the client sends none (CAP `cuid` keys); optional on create */
  computedDefault: boolean;
  immutable: boolean;
  label?: string;
  description?: string;
  /** Member names if the property is an enum type */
  enumValues?: string[];
  /** Entity set that serves as value help, from Common.ValueList */
  valueListSet?: string;
}

export interface NavigationDescriptor {
  name: string;
  target: string;
  isCollection: boolean;
  /** Children are owned by the parent: deleted with it and creatable in the same request */
  composition: boolean;
  /** Navigation property on the target that points back */
  partner?: string;
}

export interface CompositionDescriptor {
  /** Navigation property name, used as property of the create payload */
  name: string;
  typeName: string;
  isCollection: boolean;
  properties: PropertyDescriptor[];
  /** Properties of the child that point to the parent; set by the server on deep create */
  foreignKeys: string[];
}

export interface EntitySetDescriptor extends SetCapabilities {
  name: string;
  typeName: string;
  keys: string[];
  properties: PropertyDescriptor[];
  navigationProperties: NavigationDescriptor[];
  compositions: CompositionDescriptor[];
  label?: string;
  description?: string;
  /** Has IsActiveEntity, i.e. is part of a draft-enabled service */
  draft: boolean;
  /** Draft root: has DraftAdministrativeData, so the draft guard can run */
  draftRoot: boolean;
}

export interface ParameterDescriptor {
  name: string;
  edmType: string;
  nullable: boolean;
  isCollection: boolean;
  maxLength?: number;
}

export interface OperationDescriptor {
  /** Import name for unbound, simple name for bound operations */
  name: string;
  kind: "action" | "function";
  qualifiedName: string;
  /** Entity set the operation is bound to; undefined if unbound */
  entitySet?: string;
  parameters: ParameterDescriptor[];
  returnType?: string;
  returnsCollection: boolean;
  label?: string;
  description?: string;
}

export interface ServiceDescriptor {
  entitySets: EntitySetDescriptor[];
  operations: OperationDescriptor[];
}

type Raw = Record<string, any>;

/** Actions CAP adds to draft-enabled entities; handled by the guard, not exposed as tools */
const DRAFT_OPERATIONS = new Set([
  "draftEdit",
  "draftActivate",
  "draftPrepare",
  "DraftEdit",
  "DraftActivate",
  "DraftPrepare",
]);

const EDM_PREFIX = "Edm.";

/**
 * Reads the service's `$metadata` through the model's meta model and
 * condenses it into descriptors that the tool builders work with.
 */
export async function introspect(model: ODataModel): Promise<ServiceDescriptor> {
  const metaModel = model.getMetaModel() as ODataMetaModel;
  // `requestObject("/")` would only return the entity container; `requestData()` has the whole document incl. $Annotations
  const root = (await metaModel.requestData()) as Raw;
  const containerName = root.$EntityContainer as string;
  const container = root[containerName] as Raw;

  const entitySets: EntitySetDescriptor[] = [];
  const operations: OperationDescriptor[] = [];

  for (const [name, entry] of Object.entries(container)) {
    if (name.startsWith("$") || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Raw;
    if (raw.$kind === "EntitySet") {
      entitySets.push(describeEntitySet(root, containerName, name, raw));
    } else if (raw.$kind === "ActionImport") {
      const op = describeOperation(root, name, "action", raw.$Action);
      if (op) {
        operations.push(op);
      }
    } else if (raw.$kind === "FunctionImport") {
      const op = describeOperation(root, name, "function", raw.$Function);
      if (op) {
        operations.push(op);
      }
    }
  }

  // Bound operations are not in the container, they are schema-level overloads
  const setByType = new Map(entitySets.map((set) => [set.typeName, set]));
  for (const [qualifiedName, overloads] of Object.entries(root)) {
    if (!Array.isArray(overloads)) {
      continue;
    }
    for (const overload of overloads as Raw[]) {
      if (!overload.$IsBound || overload.$kind === undefined) {
        continue;
      }
      const bindingType = overload.$Parameter?.[0]?.$Type as string | undefined;
      const set = bindingType ? setByType.get(bindingType) : undefined;
      const simpleName = qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);
      if (!set || overload.$Parameter[0].$isCollection || DRAFT_OPERATIONS.has(simpleName)) {
        continue;
      }
      const op = describeOperation(
        root,
        simpleName,
        overload.$kind === "Function" ? "function" : "action",
        qualifiedName,
        set.name,
      );
      if (op) {
        operations.push(op);
      }
    }
  }

  return { entitySets, operations };
}

function describeEntitySet(
  root: Raw,
  containerName: string,
  name: string,
  raw: Raw,
): EntitySetDescriptor {
  const typeName = raw.$Type as string;
  const setAnnotations = annotationsOf(root, `${containerName}/${name}`);
  const typeAnnotations = annotationsOf(root, typeName);
  const { keys, properties, navigationProperties } = describeType(
    root,
    typeName,
  );

  // Children that are created together with their parent (one level deep, to keep schemas small)
  const compositions: CompositionDescriptor[] = navigationProperties
    // `texts` holds translations of `localized` elements, it is not meant to be filled directly
    .filter((nav) => nav.composition && nav.name !== "texts")
    .map((nav) => {
      const child = describeType(root, nav.target);
      const backReference = (root[nav.target] as Raw)[nav.partner ?? ""] as
        | Raw
        | undefined;
      return {
        name: nav.name,
        typeName: nav.target,
        isCollection: nav.isCollection,
        properties: child.properties,
        // Foreign key to the parent, which the deep create fills in itself
        foreignKeys: Object.keys(backReference?.$ReferentialConstraint ?? {}),
      };
    });

  return {
    ...readSetCapabilities(setAnnotations, typeAnnotations),
    name,
    typeName,
    keys,
    properties,
    navigationProperties,
    compositions,
    label: readLabel(typeAnnotations) ?? readLabel(setAnnotations),
    description: readDescription(typeAnnotations),
    draft: properties.some((prop) => prop.name === "IsActiveEntity"),
    draftRoot: navigationProperties.some(
      (nav) => nav.name === "DraftAdministrativeData",
    ),
  };
}

/** Keys, properties and navigation properties of an entity type */
function describeType(
  root: Raw,
  typeName: string,
): Pick<EntitySetDescriptor, "keys" | "properties" | "navigationProperties"> {
  const type = root[typeName] as Raw;
  const keys: string[] = (type.$Key ?? []).map((key: unknown) =>
    typeof key === "string" ? key : Object.keys(key as Raw)[0],
  );
  const properties: PropertyDescriptor[] = [];
  const navigationProperties: NavigationDescriptor[] = [];
  for (const [propName, value] of Object.entries(type)) {
    if (propName.startsWith("$") || typeof value !== "object") {
      continue;
    }
    const prop = value as Raw;
    if (prop.$kind === "NavigationProperty") {
      navigationProperties.push({
        name: propName,
        target: prop.$Type,
        isCollection: !!prop.$isCollection,
        // CAP compositions delete their children with the parent
        composition: prop.$OnDelete === "Cascade",
        partner: prop.$Partner,
      });
    } else if (prop.$kind === "Property") {
      const annotations = annotationsOf(root, `${typeName}/${propName}`);
      const enumType = root[prop.$Type] as Raw | undefined;
      properties.push({
        name: propName,
        edmType: prop.$Type ?? "Edm.String",
        // Edm.String is the default $Type and $Nullable defaults to true
        nullable: prop.$Nullable !== false,
        maxLength: prop.$MaxLength,
        precision: prop.$Precision,
        scale: prop.$Scale,
        isKey: keys.includes(propName),
        computed: annotations[TERM.computed] === true,
        computedDefault: annotations[TERM.computedDefault] === true,
        immutable: annotations[TERM.immutable] === true,
        label: readLabel(annotations),
        description: readDescription(annotations),
        enumValues:
          enumType?.$kind === "EnumType"
            ? Object.keys(enumType).filter((key) => !key.startsWith("$"))
            : undefined,
        valueListSet: valueListSetOf(annotations),
      });
    }
  }
  return { keys, properties, navigationProperties };
}

function valueListSetOf(annotations: Raw): string | undefined {
  const valueList = annotations[TERM.valueList] as Raw | undefined;
  return typeof valueList?.CollectionPath === "string"
    ? valueList.CollectionPath
    : undefined;
}

function describeOperation(
  root: Raw,
  name: string,
  kind: "action" | "function",
  qualifiedName: string,
  entitySet?: string,
): OperationDescriptor | undefined {
  const overloads = root[qualifiedName] as Raw[] | undefined;
  // Unbound imports reference the unbound overload; bound ones are looked up per set
  const overload = overloads?.find((candidate) =>
    entitySet ? candidate.$IsBound : !candidate.$IsBound,
  );
  if (!overload) {
    return undefined;
  }
  const rawParameters: Raw[] = overload.$Parameter ?? [];
  // The first parameter of a bound operation is the binding parameter
  const parameters = (entitySet ? rawParameters.slice(1) : rawParameters).map(
    (parameter) => ({
      name: parameter.$Name,
      edmType: parameter.$Type ?? "Edm.String",
      nullable: parameter.$Nullable !== false,
      isCollection: !!parameter.$isCollection,
      maxLength: parameter.$MaxLength,
    }),
  );
  // Annotation targets identify an overload by its parameter types: functions list all of them,
  // bound actions only the binding parameter and unbound actions none
  const signatureParameters =
    kind === "function" ? rawParameters : rawParameters.slice(0, entitySet ? 1 : 0);
  const annotations = annotationsOf(
    root,
    `${qualifiedName}(${signatureParameters.map((p) => p.$Type ?? "Edm.String").join(",")})`,
  );
  return {
    name,
    kind,
    qualifiedName,
    entitySet,
    parameters,
    returnType: overload.$ReturnType?.$Type,
    returnsCollection: !!overload.$ReturnType?.$isCollection,
    label: readLabel(annotations),
    description: readDescription(annotations),
  };
}

export function isPrimitive(edmType: string): boolean {
  return edmType.startsWith(EDM_PREFIX);
}
