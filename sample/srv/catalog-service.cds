using {sap.capire.bookshop as my} from '../db/schema';
using {sap.common.Currencies as CommonCurrencies} from '@sap/cds/common';

service CatalogService {
  // Draft-enabled: tools work on active data (draft bypass) and must check for existing drafts.
  // modifiedAt is the ETag, so concurrent updates fail with 412.
  @odata.draft.enabled
  entity Books as projection on my.Books actions {
    @Core.Description: 'Increases the stock of this book by the given positive quantity and returns the updated book.'
    action addStock(quantity: Integer) returns Books;

    @Core.Description: 'Sells one copy of this book and returns the updated book. Not available when the book is out of stock.'
    @Core.OperationAvailable: in.hasStock
    action sellOne() returns Books;

    // Same action name as on Authors, but another binding type and other parameters: an overload
    @Core.Description: 'Changes the title of this book and returns the updated book.'
    action rename(title: String) returns Books;
  };
  annotate Books with {
    modifiedAt @odata.etag;
  };

  entity Authors as projection on my.Authors actions {
    @Core.Description: 'Changes the name of this author and returns the updated author.'
    action rename(name: String) returns Authors;

    // Bound to the whole collection: Authors/CatalogService.normalizeNames
    // (on Books this would need an If-Match header, because Books has an ETag)
    @cds.odata.bindingparameter.collection
    @Core.Description: 'Trims and collapses repeated spaces in the names of all authors and returns how many names changed.'
    action normalizeNames() returns Integer;
  };

  // A node of the draft tree: only changed through Books. The action tests the draft guard on nodes.
  entity Chapters as projection on my.Chapters actions {
    @Core.Description: 'Renumbers nothing, only touches the chapter and returns it (test action on a draft node).'
    action touch() returns Chapters;
  };

  entity Covers as projection on my.Covers;

  entity Sections as projection on my.Sections;

  @hierarchy
  entity Genres as projection on my.Genres;

  // Single instance without a key in the URL: /Shop
  @odata.singleton
  entity Shop as projection on my.Shop;

  // Reference data, not writable
  @readonly
  entity Currencies as projection on CommonCurrencies;

  // Create only
  @insertonly
  entity Orders as projection on my.Orders;

  @Core.Description: 'Puts one random emoji in front of and behind the title of every book. Emoji already at the start or end of a title are replaced, so running it again picks a new one. Books with an unsaved draft are skipped.'
  action   emojifyBooks();
  function topBooks(count : Integer) returns array of Books;
}

// Tools act as the signed-in user, so these restrictions apply to the AI agent exactly as they apply to the user:
// Viewers read, Admins change data and run actions.
// (CAP evaluates @restrict on entities and operations only, a service-level @restrict is silently ignored.)
annotate CatalogService.Books with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

annotate CatalogService.Authors with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

annotate CatalogService.Chapters with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

annotate CatalogService.Sections with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

annotate CatalogService.Genres with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

annotate CatalogService.Currencies with @(restrict: [{
  grant: 'READ',
  to   : ['Viewer', 'Admin']
}]);

annotate CatalogService.Orders with @(restrict: [{
  grant: ['READ', 'CREATE'],
  to   : 'Admin'
}]);

annotate CatalogService.emojifyBooks with @(requires: 'Admin');
annotate CatalogService.topBooks with @(requires: ['Viewer', 'Admin']);

// Announces which $apply transformations the service supports; the aggregate tool is built from this
annotate CatalogService.Books with @Aggregation.ApplySupported: {
  Transformations        : [
    'aggregate',
    'groupby',
    'filter'
  ],
  GroupableProperties    : [
    genre_ID,
    author_ID,
    currency_code
  ],
  AggregatableProperties : [
    {
      Property                  : stock,
      SupportedAggregationMethods: [
        'sum',
        'min',
        'max',
        'average'
      ]
    },
    {
      Property                  : price,
      SupportedAggregationMethods: [
        'sum',
        'min',
        'max',
        'average'
      ]
    }
  ]
};

annotate CatalogService.Shop with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

// After addStock only the stock of this book changed, so the UI needs nothing else reloaded
annotate CatalogService.Books actions {
  addStock @Common.SideEffects: {
    TargetEntities  : [in],
    TargetProperties: ['stock']
  };
};

annotate CatalogService.Covers with @(restrict: [
  {
    grant: 'READ',
    to   : ['Viewer', 'Admin']
  },
  {
    grant: '*',
    to   : 'Admin'
  }
]);

// Custom aggregate as CAP documents it: the measure names its default method, the entity exposes the aggregate.
// `aggregate(stock)` then means `aggregate(stock with sum as stock)`.
annotate CatalogService.Books with {
  stock @Aggregation.default: #SUM;
};
annotate CatalogService.Books with @Aggregation.CustomAggregate #stock: 'Edm.Int32';
