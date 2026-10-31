using {sap.capire.bookshop as my} from '../db/schema';
using {sap.common.Currencies as CommonCurrencies} from '@sap/cds/common';

service CatalogService {
  // Draft-enabled: tools work on active data (draft bypass) and must check for existing drafts.
  // modifiedAt is the ETag, so concurrent updates fail with 412.
  @odata.draft.enabled
  entity Books as projection on my.Books actions {
    @Core.Description: 'Increases the stock of this book by the given positive quantity and returns the updated book.'
    action addStock(quantity: Integer) returns Books;
  };
  annotate Books with {
    modifiedAt @odata.etag;
  };

  entity Authors as projection on my.Authors;

  entity Chapters as projection on my.Chapters;

  @hierarchy
  entity Genres as projection on my.Genres;

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
