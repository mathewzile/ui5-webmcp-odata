/**
 * Shape of `ODataMetaModel#requestData()` for a CAP service, reduced to what the
 * introspector reads. Mirrors what the sample's CatalogService returns in UI5 1.153.
 */
const guid = { $kind: "Property", $Type: "Edm.Guid", $Nullable: false };

export const metadata = {
  $Version: "4.0",
  $EntityContainer: "CatalogService.EntityContainer",
  "CatalogService.Status": { $kind: "EnumType", Open: 0, Closed: 1 },
  "CatalogService.Books": {
    $kind: "EntityType",
    $Key: ["ID", "IsActiveEntity"],
    ID: guid,
    title: { $kind: "Property", $MaxLength: 111 },
    status: { $kind: "Property", $Type: "CatalogService.Status" },
    stock: { $kind: "Property", $Type: "Edm.Int32" },
    price: { $kind: "Property", $Type: "Edm.Decimal", $Precision: 9, $Scale: 2 },
    modifiedAt: { $kind: "Property", $Type: "Edm.DateTimeOffset" },
    IsActiveEntity: {
      $kind: "Property",
      $Type: "Edm.Boolean",
      $Nullable: false,
    },
    chapters: {
      $kind: "NavigationProperty",
      $isCollection: true,
      $Type: "CatalogService.Chapters",
      $Partner: "book",
      $OnDelete: "Cascade",
    },
    texts: {
      $kind: "NavigationProperty",
      $isCollection: true,
      $Type: "CatalogService.Books_texts",
      $OnDelete: "Cascade",
    },
    author: {
      $kind: "NavigationProperty",
      $Type: "CatalogService.Authors",
      $ReferentialConstraint: { author_ID: "ID" },
    },
    DraftAdministrativeData: {
      $kind: "NavigationProperty",
      $Type: "CatalogService.DraftAdministrativeData",
    },
  },
  "CatalogService.Chapters": {
    $kind: "EntityType",
    $Key: ["ID"],
    ID: guid,
    book_ID: { $kind: "Property", $Type: "Edm.Guid" },
    number: { $kind: "Property", $Type: "Edm.Int32" },
    title: { $kind: "Property" },
    book: {
      $kind: "NavigationProperty",
      $Type: "CatalogService.Books",
      $Partner: "chapters",
      $ReferentialConstraint: { book_ID: "ID" },
    },
  },
  "CatalogService.Books_texts": {
    $kind: "EntityType",
    $Key: ["locale", "ID"],
    locale: { $kind: "Property", $Nullable: false },
    ID: guid,
    title: { $kind: "Property" },
  },
  "CatalogService.Authors": {
    $kind: "EntityType",
    $Key: ["ID"],
    ID: guid,
    name: { $kind: "Property", $MaxLength: 111, $Nullable: false },
    createdAt: { $kind: "Property", $Type: "Edm.DateTimeOffset" },
    tags: { $kind: "Property", $isCollection: true },
    rating: { $kind: "Property", $Type: "CatalogService.Rating" },
    address: { $kind: "Property", $Type: "CatalogService.Address" },
    photo: { $kind: "Property", $Type: "Edm.Stream" },
  },
  "CatalogService.Rating": {
    $kind: "TypeDefinition",
    $UnderlyingType: "Edm.Decimal",
    $Precision: 3,
    $Scale: 1,
  },
  "CatalogService.Address": {
    $kind: "ComplexType",
    street: { $kind: "Property", $Nullable: false },
    country: { $kind: "Property", $Type: "CatalogService.Country" },
  },
  "CatalogService.Country": {
    $kind: "ComplexType",
    code: { $kind: "Property", $MaxLength: 2 },
  },
  "CatalogService.Orders": {
    $kind: "EntityType",
    $Key: ["ID"],
    ID: guid,
    quantity: { $kind: "Property", $Type: "Edm.Int32" },
  },
  "CatalogService.addStock": [
    {
      $kind: "Action",
      $IsBound: true,
      $Parameter: [
        { $Type: "CatalogService.Books", $Name: "in" },
        { $Type: "Edm.Int32", $Name: "quantity", $Nullable: false },
      ],
      $ReturnType: { $Type: "CatalogService.Books" },
    },
    // Same name, bound to another type and with other parameters
    {
      $kind: "Action",
      $IsBound: true,
      $Parameter: [
        { $Type: "CatalogService.Authors", $Name: "in" },
        { $Type: "Edm.Int32", $Name: "amount", $Nullable: false },
        { $Type: "Edm.String", $Name: "reason" },
      ],
    },
  ],
  "CatalogService.importBooks": [
    {
      $kind: "Action",
      $IsBound: true,
      $Parameter: [
        { $Type: "CatalogService.Books", $isCollection: true, $Name: "in" },
        { $Type: "Edm.String", $Name: "source", $Nullable: false },
      ],
    },
  ],
  "CatalogService.draftEdit": [
    {
      $kind: "Action",
      $IsBound: true,
      $Parameter: [{ $Type: "CatalogService.Books", $Name: "in" }],
    },
  ],
  "CatalogService.emojifyBooks": [{ $kind: "Action" }],
  "CatalogService.topBooks": [
    {
      $kind: "Function",
      $Parameter: [{ $Name: "count", $Type: "Edm.Int32" }],
      $ReturnType: { $Type: "CatalogService.Books", $isCollection: true },
    },
  ],
  "CatalogService.Settings": {
    $kind: "EntityType",
    $Key: ["ID"],
    ID: guid,
    theme: { $kind: "Property" },
  },
  "CatalogService.EntityContainer": {
    $kind: "EntityContainer",
    Settings: { $kind: "Singleton", $Type: "CatalogService.Settings" },
    Books: { $kind: "EntitySet", $Type: "CatalogService.Books" },
    Books_texts: { $kind: "EntitySet", $Type: "CatalogService.Books_texts" },
    Authors: { $kind: "EntitySet", $Type: "CatalogService.Authors" },
    Orders: { $kind: "EntitySet", $Type: "CatalogService.Orders" },
    // A second set of the same type: bound operations belong to both
    ArchivedBooks: { $kind: "EntitySet", $Type: "CatalogService.Books" },
    emojifyBooks: {
      $kind: "ActionImport",
      $Action: "CatalogService.emojifyBooks",
    },
    topBooks: {
      $kind: "FunctionImport",
      $Function: "CatalogService.topBooks",
    },
  },
  $Annotations: {
    "CatalogService.EntityContainer/Orders": {
      "@Org.OData.Capabilities.V1.ReadRestrictions": { Readable: false },
      "@Org.OData.Capabilities.V1.UpdateRestrictions": { Updatable: false },
      "@Org.OData.Capabilities.V1.DeleteRestrictions": { Deletable: false },
    },
    "CatalogService.EntityContainer/Authors": {
      "@Org.OData.Capabilities.V1.SearchRestrictions": { Searchable: false },
      "@Org.OData.Capabilities.V1.FilterRestrictions": {
        NonFilterableProperties: [{ $PropertyPath: "createdAt" }],
      },
    },
    "CatalogService.EntityContainer/Books": {
      "@com.sap.vocabularies.Common.v1.DraftRoot": {},
    },
    "CatalogService.Books": {
      "@Org.OData.Core.V1.OptimisticConcurrency": [{ $PropertyPath: "modifiedAt" }],
      "@Org.OData.Core.V1.Description": "A book in the catalog",
    },
    "CatalogService.Books/ID": {
      "@Org.OData.Core.V1.ComputedDefaultValue": true,
    },
    "CatalogService.Books/title": {
      "@com.sap.vocabularies.Common.v1.Label": "Title",
      "@com.sap.vocabularies.Common.v1.FieldControl": {
        $EnumMember: "com.sap.vocabularies.Common.v1.FieldControlType/Mandatory",
      },
    },
    "CatalogService.Books/stock": {
      "@Org.OData.Validation.V1.Minimum": 0,
      "@Org.OData.Validation.V1.Maximum": 9999,
      "@com.sap.vocabularies.Common.v1.Text": { $Path: "title" },
    },
    "CatalogService.EntityContainer/ArchivedBooks": {
      "@Org.OData.Aggregation.V1.ApplySupported": {
        Transformations: ["aggregate", "groupby"],
        GroupableProperties: [{ $PropertyPath: "status" }],
      },
      "@Org.OData.Capabilities.V1.ExpandRestrictions": { Expandable: false },
    },
    "CatalogService.Books/modifiedAt": { "@Org.OData.Core.V1.Computed": true },
    "CatalogService.Authors/createdAt": {
      "@Org.OData.Core.V1.Computed": true,
      "@Org.OData.Core.V1.Immutable": true,
    },
    "CatalogService.Books/status": {
      "@com.sap.vocabularies.Common.v1.ValueList": { CollectionPath: "Statuses" },
    },
    // Operation targets: bound actions name the binding parameter only, functions all parameters
    "CatalogService.addStock(CatalogService.Books)": {
      "@Org.OData.Core.V1.Description": "Increases the stock",
      "@Org.OData.Core.V1.OperationAvailable": { $Path: "canAddStock" },
      "@com.sap.vocabularies.Common.v1.SideEffects": {
        TargetProperties: ["stock"],
      },
    },
    "CatalogService.emojifyBooks()": {
      "@Org.OData.Core.V1.Description": "Adds emoji to titles",
      "@com.sap.vocabularies.Common.v1.Label": "Emojify",
    },
    "CatalogService.topBooks(Edm.Int32)": {
      "@Org.OData.Core.V1.Description": "Books with the most stock",
    },
  },
};
