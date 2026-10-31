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
  chapters : Composition of many Chapters
               on chapters.book = $self;
}

entity Chapters : cuid {
  book   : Association to Books;
  number : Integer;
  title  : String(111);
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
