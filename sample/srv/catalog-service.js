import cds from "@sap/cds";

const EMOJIS = ["📚", "📖", "🔖", "✨", "🌟", "🎭", "🕯️", "🦉", "🐈", "🌹", "🗝️", "🌙", "🍂", "🔥", "🎩"];

// One emoji, including variation selectors and joined sequences such as 👩‍💻
const EMOJI = "\\p{Extended_Pictographic}(?:\\uFE0F|\\u200D\\p{Extended_Pictographic})*\\uFE0F?";
const LEADING_EMOJI = new RegExp(`^(?:${EMOJI}\\s*)+`, "u");
const TRAILING_EMOJI = new RegExp(`(?:\\s*${EMOJI})+$`, "u");

/** Removes emoji at the start and at the end of a title, so repeated runs do not pile them up */
const stripEmoji = (title = "") =>
  title.replace(LEADING_EMOJI, "").replace(TRAILING_EMOJI, "");

export default class CatalogService extends cds.ApplicationService {
  init() {
    const { Books, Authors, Chapters } = this.entities;

    // Bound action: Books(ID=...,IsActiveEntity=true)/CatalogService.addStock
    this.on("addStock", Books, async (req) => {
      const { quantity } = req.data;
      if (!(quantity > 0)) {
        return req.error(400, "quantity must be positive");
      }
      const [{ ID }] = req.params;
      await UPDATE(Books, ID).with(`stock = stock + ${Number(quantity)}`);
      return SELECT.one.from(Books, ID);
    });

    this.on("sellOne", Books, async (req) => {
      const [{ ID }] = req.params;
      const { stock } = await SELECT.one.from(Books, ID).columns("stock");
      if (!(stock > 0)) {
        return req.error(409, "The book is out of stock");
      }
      await UPDATE(Books, ID).with("stock = stock - 1");
      return SELECT.one.from(Books, ID);
    });

    // Overload: one name, bound to two entity types with different parameters
    this.on("rename", Books, async (req) => {
      const [{ ID }] = req.params;
      const { title } = req.data;
      if (!title?.trim()) {
        return req.error(400, "title must not be empty");
      }
      await UPDATE(Books, ID).with({ title });
      return SELECT.one.from(Books, ID);
    });

    this.on("rename", Authors, async (req) => {
      const [{ ID }] = req.params;
      const { name } = req.data;
      if (!name?.trim()) {
        return req.error(400, "name must not be empty");
      }
      await UPDATE(Authors, ID).with({ name });
      return SELECT.one.from(Authors, ID);
    });

    // Bound to the collection, so there is no key in req.params
    this.on("normalizeNames", Authors, async () => {
      const authors = await SELECT.from(Authors).columns("ID", "name");
      let changed = 0;
      for (const { ID, name } of authors) {
        const normalized = (name ?? "").trim().replace(/\s+/g, " ");
        if (normalized !== name) {
          await UPDATE(Authors, ID).with({ name: normalized });
          changed++;
        }
      }
      return changed;
    });

    // Server-side validation, to see how a failure in the middle of a deep update is reported
    this.before(["CREATE", "UPDATE"], Chapters, (req) => {
      if (req.data.title === "BAD") {
        req.error({ status: 400, message: "A chapter must not be called BAD", target: "title" });
      }
    });

    this.on("touch", Chapters, async (req) => {
      const [{ ID }] = req.params;
      return SELECT.one.from(Chapters, ID);
    });

    this.on("topBooks", async (req) => {
      const { count } = req.data;
      return SELECT.from(Books).orderBy("stock desc").limit(count ?? 3);
    });

    this.on("emojifyBooks", async (req) => {
      const emoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
      // A draft would overwrite the new title when it is activated, so books being edited are left alone
      const drafts = new Set(
        (await SELECT.from(Books.drafts).columns("ID")).map((draft) => draft.ID),
      );
      const books = await SELECT.from(Books).columns("ID", "title");
      const emojify = books.filter((book) => !drafts.has(book.ID));
      await Promise.all(
        emojify.map(({ ID, title }) =>
          UPDATE(Books, ID).with({ title: `${emoji} ${stripEmoji(title)} ${emoji}` }),
        ),
      );
      if (emojify.length < books.length) {
        req.info(`Skipped ${books.length - emojify.length} book(s) with an unsaved draft`);
      }
    });

    return super.init();
  }
}
