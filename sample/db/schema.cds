using {
  cuid,
  managed,
  Currency
} from '@sap/cds/common';

namespace sap.capire.bookshop;

entity Authors : cuid {
  name        : String(111) @mandatory;
  dateOfBirth : Date;
  books       : Association to many Books
                  on books.author = $self;
}

entity Books : cuid, managed {
  title    : localized String(111) @mandatory;
  descr    : localized String(1111);
  author   : Association to Authors;
  genre    : Association to Genres;
  stock    : Integer;
  price    : Decimal(9, 2);
  currency : Currency;
  // Calculated on read; Core.OperationAvailable of sellOne points at it
  hasStock : Boolean = (stock > 0);
  chapters : Composition of many Chapters
               on chapters.book = $self;
  // To-one composition
  cover    : Composition of one Covers
               on cover.book = $self;
}

entity Covers : cuid {
  book  : Association to Books;
  color : String(40);
  style : String(40);
}

entity Chapters : cuid {
  book     : Association to Books;
  number   : Integer;
  title    : String(111);
  sections : Composition of many Sections
               on sections.chapter = $self;
}

entity Sections : cuid {
  chapter : Association to Chapters;
  number  : Integer;
  text    : String(1111);
}

entity Genres : cuid {
  parent   : Association to Genres;
  children : Composition of many Genres
               on children.parent = $self;
  name     : localized String;
}

entity Orders : cuid, managed {
  book     : Association to Books;
  quantity : Integer;
}

// Single instance, read and updated without a key
entity Shop {
  key ID      : Integer;
      name    : String(111);
      motto   : String(255);
      isOpen  : Boolean default true;
}
