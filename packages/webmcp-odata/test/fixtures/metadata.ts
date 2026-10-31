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
  "CatalogService.EntityContainer": {
    $kind: "EntityContainer",
    Books: { $kind: "EntitySet", $Type: "CatalogService.Books" },
    Books_texts: { $kind: "EntitySet", $Type: "CatalogService.Books_texts" },
    Authors: { $kind: "EntitySet", $Type: "CatalogService.Authors" },
    Orders: { $kind: "EntitySet", $Type: "CatalogService.Orders" },
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
