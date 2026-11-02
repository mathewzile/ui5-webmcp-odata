import type ODataMetaModel from "sap/ui/model/odata/v4/ODataMetaModel";
import type ODataModel from "sap/ui/model/odata/v4/ODataModel";
import {
  TERM,
  annotationsOf,
  readAggregation,
  readDescription,
  readFieldControl,
  readHierarchies,
  readLabel,
  readOperationAvailable,
  readSetCapabilities,
  readSideEffects,
  readTextPath,
  readValidation,
  type AggregationSupport,
  type FieldControl,
  type HierarchyDescriptor,
  type SetCapabilities,
  type SideEffects,
} from "./Capabilities";

export interface PropertyDescriptor {
  name: string;
  edmType: string;
  nullable: boolean;
  maxLength?: number;
  precision?: number;
  scale?: number;
  /** `Collection(...)` of the type */
  isCollection?: boolean;
  /** Properties of a complex type, so clients get a real object schema (nested types are cut off after a few levels) */
  complexProperties?: PropertyDescriptor[];
  /** Streams and geo types cannot be sent as JSON values; they are never offered as input */
  unsupported?: boolean;
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
  /** The value help lists all valid values, so the property behaves like an enum */
  valueListFixed?: boolean;
  /** Static Common.FieldControl: mandatory properties are required, read-only ones cannot be written */
  fieldControl?: FieldControl;
  /** Property that holds the text for this ID (Common.Text) */
  textPath?: string;
  minimum?: number;
  maximum?: number;
  /** Validation.AllowedValues, for properties that are not enum types */
  allowedValues?: (string | number)[];
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
  /** Navigation property of the child that points back to the parent */
  partner?: string;
  /** Properties of the child that point to the parent; set by the server on deep create */
  foreignKeys: string[];
  /** Compositions of the child itself, down to the depth limit */
  compositions: CompositionDescriptor[];
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
  /**
   * Draft node: part of a draft tree but not its root. The service only accepts changes
   * to it through the root (422 DRAFT_MODIFICATION_ONLY_VIA_ROOT), never by its own path.
   */
  draftNode: boolean;
  /** Recursive hierarchies of the entity type (e.g. a CAP `@hierarchy` entity) */
  hierarchies: HierarchyDescriptor[];
  /** What the service accepts in `$apply`; undefined if it does not announce support */
  aggregation?: AggregationSupport;
}

/** A single instance in the service root, read and updated without a key */
export interface SingletonDescriptor {
  name: string;
  typeName: string;
  properties: PropertyDescriptor[];
  updatable: boolean;
  label?: string;
  description?: string;
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
  /** Bound to the collection of the set instead of a single entry */
  boundToCollection?: boolean;
  parameters: ParameterDescriptor[];
  returnType?: string;
  returnsCollection: boolean;
  label?: string;
  description?: string;
  /** `false`: never available; a path: property of the entry that says if it is available for that entry */
  available?: boolean | { path: string };
  /** What the service says to reload after the operation (Common.SideEffects) */
  sideEffects?: SideEffects;
}

export interface ServiceDescriptor {
  entitySets: EntitySetDescriptor[];
  singletons: SingletonDescriptor[];
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
export async function introspect(
  model: ODataModel,
  maxCompositionDepth = 3,
): Promise<ServiceDescriptor> {
  const metaModel = model.getMetaModel() as ODataMetaModel;
  // `requestObject("/")` would only return the entity container; `requestData()` has the whole document incl. $Annotations
  const root = (await metaModel.requestData()) as Raw;
  const containerName = root.$EntityContainer as string;
  const container = root[containerName] as Raw;

  const entitySets: EntitySetDescriptor[] = [];
  const singletons: SingletonDescriptor[] = [];
  const operations: OperationDescriptor[] = [];

  for (const [name, entry] of Object.entries(container)) {
    if (name.startsWith("$") || typeof entry !== "object") {
      continue;
    }
    const raw = entry as Raw;
    if (raw.$kind === "EntitySet") {
      entitySets.push(
        describeEntitySet(root, containerName, name, raw, maxCompositionDepth),
      );
    } else if (raw.$kind === "Singleton") {
      singletons.push(describeSingleton(root, containerName, name, raw));
    } else if (raw.$kind === "ActionImport" || raw.$kind === "FunctionImport") {
      const kind = raw.$kind === "ActionImport" ? "action" : "function";
      const qualifiedName = (kind === "action" ? raw.$Action : raw.$Function) as string;
      // An import references the unbound overload
      const overload = (root[qualifiedName] as Raw[] | undefined)?.find(
        (candidate) => !candidate.$IsBound,
      );
      if (overload) {
        operations.push(describeOperation(root, name, kind, qualifiedName, overload));
      }
    }
  }

  // Bound operations are not in the container, they are schema-level overloads.
  // Each overload is bound to one entity type, and every entity set of that type gets it.
  const setsByType = new Map<string, EntitySetDescriptor[]>();
  for (const set of entitySets) {
    setsByType.set(set.typeName, [...(setsByType.get(set.typeName) ?? []), set]);
  }
  for (const [qualifiedName, overloads] of Object.entries(root)) {
    if (!Array.isArray(overloads)) {
      continue;
    }
    const simpleName = qualifiedName.slice(qualifiedName.lastIndexOf(".") + 1);
    if (DRAFT_OPERATIONS.has(simpleName)) {
      continue;
    }
    for (const overload of overloads as Raw[]) {
      if (!overload.$IsBound || overload.$kind === undefined) {
        continue;
      }
      const bindingParameter = overload.$Parameter?.[0] as Raw | undefined;
      const sets = setsByType.get(bindingParameter?.$Type as string) ?? [];
      for (const set of sets) {
        operations.push(
          describeOperation(
            root,
            simpleName,
            overload.$kind === "Function" ? "function" : "action",
            qualifiedName,
            overload,
            set.name,
            !!bindingParameter?.$isCollection,
          ),
        );
      }
    }
  }

  return { entitySets, singletons, operations };
}

function describeSingleton(
  root: Raw,
  containerName: string,
  name: string,
  raw: Raw,
): SingletonDescriptor {
  const typeName = raw.$Type as string;
  const setAnnotations = annotationsOf(root, `${containerName}/${name}`);
  const typeAnnotations = annotationsOf(root, typeName);
  return {
    name,
    typeName,
    properties: describeType(root, typeName).properties,
    updatable: readSetCapabilities(setAnnotations, typeAnnotations).updatable,
    label: readLabel(typeAnnotations) ?? readLabel(setAnnotations),
    description: readDescription(typeAnnotations),
  };
}

function describeCompositions(
  root: Raw,
  navigationProperties: NavigationDescriptor[],
  depth: number,
): CompositionDescriptor[] {
  if (depth < 1) {
    return [];
  }
  return (
    navigationProperties
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
          partner: nav.partner,
          // Foreign key to the parent, which the deep create fills in itself
          foreignKeys: Object.keys(backReference?.$ReferentialConstraint ?? {}),
          // Self-references (Genres.children) stop at the depth limit
          compositions: describeCompositions(
            root,
            child.navigationProperties,
            depth - 1,
          ),
        };
      })
  );
}

function describeEntitySet(
  root: Raw,
  containerName: string,
  name: string,
  raw: Raw,
  maxCompositionDepth: number,
): EntitySetDescriptor {
  const typeName = raw.$Type as string;
  const setAnnotations = annotationsOf(root, `${containerName}/${name}`);
  const typeAnnotations = annotationsOf(root, typeName);
  const { keys, properties, navigationProperties } = describeType(
    root,
    typeName,
  );

  // Children that are written together with their parent, down to `maxCompositionDepth` levels
  const compositions = describeCompositions(
    root,
    navigationProperties,
    maxCompositionDepth,
  );

  const draft = properties.some((prop) => prop.name === "IsActiveEntity");
  // CAP adds DraftAdministrativeData to nodes as well, so the explicit annotations decide;
  // the navigation property is only the fallback for services that do not annotate
  const annotatedRoot = setAnnotations[TERM.draftRoot] !== undefined;
  const annotatedNode = setAnnotations[TERM.draftNode] !== undefined;
  const draftRoot =
    annotatedRoot ||
    (!annotatedNode &&
      navigationProperties.some((nav) => nav.name === "DraftAdministrativeData"));
  const draftNode = draft && !draftRoot;
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
    draft,
    draftRoot,
    draftNode,
    hierarchies: readHierarchies(typeAnnotations).map((hierarchy) => {
      const navigation = (root[typeName] as Raw)[hierarchy.parentNavigation] as
        | Raw
        | undefined;
      return {
        ...hierarchy,
        parentKey: Object.keys(navigation?.$ReferentialConstraint ?? {})[0],
      };
    }),
    aggregation: readAggregation(setAnnotations, typeAnnotations),
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
      const resolved = resolveType(root, prop);
      const enumType = root[resolved.edmType] as Raw | undefined;
      const validation = readValidation(annotations);
      const complexType =
        root[resolved.edmType]?.$kind === "ComplexType"
          ? complexProperties(root, resolved.edmType, 0)
          : undefined;
      properties.push({
        name: propName,
        edmType: resolved.edmType,
        // Edm.String is the default $Type and $Nullable defaults to true
        nullable: prop.$Nullable !== false,
        maxLength: resolved.maxLength,
        precision: resolved.precision,
        scale: resolved.scale,
        isCollection: !!prop.$isCollection,
        complexProperties: complexType,
        unsupported: UNSUPPORTED_TYPE.test(resolved.edmType),
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
        valueListFixed: annotations[TERM.valueListFixed] === true,
        fieldControl: readFieldControl(annotations),
        textPath: readTextPath(annotations),
        minimum: validation.minimum,
        maximum: validation.maximum,
        allowedValues: validation.allowedValues,
      });
    }
  }
  return { keys, properties, navigationProperties };
}

const UNSUPPORTED_TYPE = /^Edm\.(Stream|Geography|Geometry)/;

/** Nested complex types are cut off here, so recursive types cannot blow up a schema */
const MAX_COMPLEX_DEPTH = 3;

/**
 * Follows a `TypeDefinition` (a named primitive type) to its underlying Edm type;
 * facets on the property win over those of the definition.
 */
export function resolveType(
  root: Raw,
  prop: Raw,
): Pick<PropertyDescriptor, "edmType" | "maxLength" | "precision" | "scale"> {
  const type = prop.$Type ?? "Edm.String";
  const definition = root[type] as Raw | undefined;
  if (definition?.$kind === "TypeDefinition") {
    return {
      edmType: definition.$UnderlyingType ?? "Edm.String",
      maxLength: prop.$MaxLength ?? definition.$MaxLength,
      precision: prop.$Precision ?? definition.$Precision,
      scale: prop.$Scale ?? definition.$Scale,
    };
  }
  return {
    edmType: type,
    maxLength: prop.$MaxLength,
    precision: prop.$Precision,
    scale: prop.$Scale,
  };
}

function complexProperties(
  root: Raw,
  typeName: string,
  depth: number,
): PropertyDescriptor[] | undefined {
  if (depth >= MAX_COMPLEX_DEPTH) {
    return undefined;
  }
  const type = root[typeName] as Raw;
  const result: PropertyDescriptor[] = [];
  for (const [name, value] of Object.entries(type)) {
    if (name.startsWith("$") || typeof value !== "object") {
      continue;
    }
    const prop = value as Raw;
    if (prop.$kind !== "Property") {
      continue;
    }
    const resolved = resolveType(root, prop);
    result.push({
      name,
      ...resolved,
      nullable: prop.$Nullable !== false,
      isCollection: !!prop.$isCollection,
      unsupported: UNSUPPORTED_TYPE.test(resolved.edmType),
      complexProperties:
        root[resolved.edmType]?.$kind === "ComplexType"
          ? complexProperties(root, resolved.edmType, depth + 1)
          : undefined,
      isKey: false,
      computed: false,
      computedDefault: false,
      immutable: false,
    });
  }
  return result;
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
  overload: Raw,
  entitySet?: string,
  boundToCollection = false,
): OperationDescriptor {
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
    boundToCollection: entitySet ? boundToCollection : undefined,
    parameters,
    returnType: overload.$ReturnType?.$Type,
    returnsCollection: !!overload.$ReturnType?.$isCollection,
    label: readLabel(annotations),
    description: readDescription(annotations),
    available: readOperationAvailable(annotations),
    sideEffects: readSideEffects(annotations),
  };
}

export function isPrimitive(edmType: string): boolean {
  return edmType.startsWith(EDM_PREFIX);
}
