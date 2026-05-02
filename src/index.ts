import { Hono } from "hono";
import { cors } from "hono/cors";
import { prettyJSON } from "hono/pretty-json";

export interface Env {
  DB: D1Database;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Category {
  id: number;
  name: string;
}

interface Chapter {
  chap_id: number;
  chapname: string | null;
  dua_count: number;
}

interface DuaListItem {
  dua_global_id: number;
  book_id: number;
  chap_id: number;
  dua_id: number | null;
  chapname: string | null;
  duaname: string;
  tags: string | null;
  ID: number | null;
  categories: Category[];
}

interface DuaDetail extends DuaListItem {
  segments: DuaSegment[];
}

interface DuaSegment {
  dua_segment_id: number;
  top: string | null;
  arabic_diacless: string | null;
  arabic: string | null;
  transliteration: string | null;
  translations: string | null;
  bottom: string | null;
  reference: string | null;
  app_reference: string | null;
  words: WordByWord[];
}

interface WordByWord {
  word_id: number;
  arabic: string;
  bn: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function paginate(url: URL) {
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20")));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

async function getCategories(db: D1Database, duaGlobalId: number): Promise<Category[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.name
       FROM dua_name_category nc
       JOIN category c ON c.id = nc.category_id
       WHERE nc.dua_global_id = ?
       ORDER BY c.id`
    )
    .bind(duaGlobalId)
    .all<Category>();
  return results;
}

async function getSegments(db: D1Database, duaGlobalId: number): Promise<DuaSegment[]> {
  const { results: segs } = await db
    .prepare(
      `SELECT dua_segment_id, top, arabic_diacless, arabic,
              transliteration, translations, bottom, reference, app_reference
       FROM dua_details
       WHERE dua_global_id = ?
       ORDER BY dua_segment_id`
    )
    .bind(duaGlobalId)
    .all<Omit<DuaSegment, "words">>();

  const { results: allWords } = await db
    .prepare(
      `SELECT dua_segment_id, word_id, arabic, bn
       FROM dua_wbw
       WHERE dua_global_id = ?
       ORDER BY dua_segment_id, word_id`
    )
    .bind(duaGlobalId)
    .all<{ dua_segment_id: number; word_id: number; arabic: string; bn: string }>();

  const wordMap = new Map<number, WordByWord[]>();
  for (const w of allWords) {
    if (!wordMap.has(w.dua_segment_id)) wordMap.set(w.dua_segment_id, []);
    wordMap.get(w.dua_segment_id)!.push({ word_id: w.word_id, arabic: w.arabic, bn: w.bn });
  }

  return segs.map((s) => ({ ...s, words: wordMap.get(s.dua_segment_id) ?? [] }));
}

const BOOK_NAMES: Record<number, string> = {
  1: "হিসনুল মুসলিম",
  2: "কুরআনের দোয়াসমূহ",
  3: "বিশেষ যিকর ও দোয়া",
};

// ── App ───────────────────────────────────────────────────────────────────────

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors());
app.use("*", prettyJSON());

// ── Root ──────────────────────────────────────────────────────────────────────

app.get("/", (c) => {
  return c.json({
    name: "Hisnul Muslim Dua API",
    version: "1.0.0",
    description: "Complete REST API for Hisnul Muslim duas in Arabic and Bengali",
    base_url: new URL(c.req.url).origin,
    endpoints: [
      { method: "GET", path: "/api/categories",                                    description: "All categories" },
      { method: "GET", path: "/api/categories/:id",                                description: "Single category" },
      { method: "GET", path: "/api/categories/:id/duas",                           description: "Duas in a category" },
      { method: "GET", path: "/api/books",                                         description: "All books" },
      { method: "GET", path: "/api/books/:bookId",                                 description: "Single book" },
      { method: "GET", path: "/api/books/:bookId/chapters",                        description: "Chapters of a book" },
      { method: "GET", path: "/api/books/:bookId/chapters/:chapId",                description: "Single chapter" },
      { method: "GET", path: "/api/books/:bookId/duas",                            description: "All duas in a book (paginated)" },
      { method: "GET", path: "/api/books/:bookId/chapters/:chapId/duas",           description: "Duas in a chapter (with full segments)" },
      { method: "GET", path: "/api/duas/random",                                   description: "Random dua (full detail)" },
      { method: "GET", path: "/api/duas/:duaGlobalId",                             description: "Full dua with segments & word-by-word" },
      { method: "GET", path: "/api/duas/:duaGlobalId/segments/:segId/words",       description: "Word-by-word for one segment" },
      { method: "GET", path: "/api/search?q=query",                                description: "Search by name/tags" },
      { method: "GET", path: "/api/search/arabic?q=query",                        description: "Search by Arabic text" },
    ],
    pagination: "?page=1&limit=20 (max 100)",
  });
});

// ── Categories ────────────────────────────────────────────────────────────────

app.get("/api/categories", async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT c.id, c.name,
              COUNT(nc.dua_global_id) as dua_count
       FROM category c
       LEFT JOIN dua_name_category nc ON c.id = nc.category_id
       GROUP BY c.id
       ORDER BY c.id`
    )
    .all<Category & { dua_count: number }>();
  return c.json({ success: true, total: results.length, data: results });
});

app.get("/api/categories/:categoryId", async (c) => {
  const id = parseInt(c.req.param("categoryId"));
  if (isNaN(id)) return c.json({ success: false, error: "Invalid category ID" }, 400);

  const row = await c.env.DB
    .prepare(
      `SELECT c.id, c.name, COUNT(nc.dua_global_id) as dua_count
       FROM category c
       LEFT JOIN dua_name_category nc ON c.id = nc.category_id
       WHERE c.id = ?
       GROUP BY c.id`
    )
    .bind(id)
    .first<Category & { dua_count: number }>();

  if (!row) return c.json({ success: false, error: "Category not found" }, 404);
  return c.json({ success: true, data: row });
});

app.get("/api/categories/:categoryId/duas", async (c) => {
  const id = parseInt(c.req.param("categoryId"));
  if (isNaN(id)) return c.json({ success: false, error: "Invalid category ID" }, 400);

  const cat = await c.env.DB
    .prepare(`SELECT id, name FROM category WHERE id = ?`)
    .bind(id)
    .first<Category>();
  if (!cat) return c.json({ success: false, error: "Category not found" }, 404);

  const { page, limit, offset } = paginate(new URL(c.req.url));

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM dua_name_category WHERE category_id = ?`)
    .bind(id)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await c.env.DB
    .prepare(
      `SELECT n.dua_global_id, n.book_id, n.chap_id, n.dua_id,
              n.chapname, n.duaname, n.tags, n.ID
       FROM dua_names n
       JOIN dua_name_category nc ON n.dua_global_id = nc.dua_global_id
       WHERE nc.category_id = ?
       ORDER BY n.dua_global_id
       LIMIT ? OFFSET ?`
    )
    .bind(id, limit, offset)
    .all<Omit<DuaListItem, "categories">>();

  const duas: DuaListItem[] = await Promise.all(
    results.map(async (d) => ({ ...d, categories: await getCategories(c.env.DB, d.dua_global_id) }))
  );

  return c.json({
    success: true,
    category: cat,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    data: duas,
  });
});

// ── Books ─────────────────────────────────────────────────────────────────────

app.get("/api/books", async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT book_id,
              COUNT(DISTINCT chap_id) as chapter_count,
              COUNT(*) as dua_count
       FROM dua_names
       GROUP BY book_id
       ORDER BY book_id`
    )
    .all<{ book_id: number; chapter_count: number; dua_count: number }>();

  return c.json({
    success: true,
    data: results.map((b) => ({ ...b, name: BOOK_NAMES[b.book_id] ?? `Book ${b.book_id}` })),
  });
});

app.get("/api/books/:bookId", async (c) => {
  const bookId = parseInt(c.req.param("bookId"));
  if (isNaN(bookId)) return c.json({ success: false, error: "Invalid book ID" }, 400);

  const row = await c.env.DB
    .prepare(
      `SELECT book_id,
              COUNT(DISTINCT chap_id) as chapter_count,
              COUNT(*) as dua_count
       FROM dua_names WHERE book_id = ?
       GROUP BY book_id`
    )
    .bind(bookId)
    .first<{ book_id: number; chapter_count: number; dua_count: number }>();

  if (!row) return c.json({ success: false, error: "Book not found" }, 404);
  return c.json({ success: true, data: { ...row, name: BOOK_NAMES[bookId] ?? `Book ${bookId}` } });
});

// ── Chapters ──────────────────────────────────────────────────────────────────

app.get("/api/books/:bookId/chapters", async (c) => {
  const bookId = parseInt(c.req.param("bookId"));
  if (isNaN(bookId)) return c.json({ success: false, error: "Invalid book ID" }, 400);

  const { results } = await c.env.DB
    .prepare(
      `SELECT chap_id,
              MAX(chapname) as chapname,
              COUNT(*) as dua_count
       FROM dua_names
       WHERE book_id = ?
       GROUP BY chap_id
       ORDER BY chap_id`
    )
    .bind(bookId)
    .all<Chapter>();

  return c.json({ success: true, book_id: bookId, total: results.length, data: results });
});

app.get("/api/books/:bookId/chapters/:chapId", async (c) => {
  const bookId = parseInt(c.req.param("bookId"));
  const chapId = parseInt(c.req.param("chapId"));
  if (isNaN(bookId) || isNaN(chapId)) return c.json({ success: false, error: "Invalid IDs" }, 400);

  const row = await c.env.DB
    .prepare(
      `SELECT chap_id, MAX(chapname) as chapname, COUNT(*) as dua_count
       FROM dua_names
       WHERE book_id = ? AND chap_id = ?
       GROUP BY chap_id`
    )
    .bind(bookId, chapId)
    .first<Chapter>();

  if (!row) return c.json({ success: false, error: "Chapter not found" }, 404);
  return c.json({ success: true, book_id: bookId, data: row });
});

// ── Duas by Book ──────────────────────────────────────────────────────────────

app.get("/api/books/:bookId/duas", async (c) => {
  const bookId = parseInt(c.req.param("bookId"));
  if (isNaN(bookId)) return c.json({ success: false, error: "Invalid book ID" }, 400);

  const { page, limit, offset } = paginate(new URL(c.req.url));

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM dua_names WHERE book_id = ?`)
    .bind(bookId)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await c.env.DB
    .prepare(
      `SELECT dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
       FROM dua_names
       WHERE book_id = ?
       ORDER BY dua_global_id
       LIMIT ? OFFSET ?`
    )
    .bind(bookId, limit, offset)
    .all<Omit<DuaListItem, "categories">>();

  const duas: DuaListItem[] = await Promise.all(
    results.map(async (d) => ({ ...d, categories: await getCategories(c.env.DB, d.dua_global_id) }))
  );

  return c.json({
    success: true,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    data: duas,
  });
});

// ── Duas by Chapter (full segments included) ──────────────────────────────────

app.get("/api/books/:bookId/chapters/:chapId/duas", async (c) => {
  const bookId = parseInt(c.req.param("bookId"));
  const chapId = parseInt(c.req.param("chapId"));
  if (isNaN(bookId) || isNaN(chapId)) return c.json({ success: false, error: "Invalid IDs" }, 400);

  const { results } = await c.env.DB
    .prepare(
      `SELECT dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
       FROM dua_names
       WHERE book_id = ? AND chap_id = ?
       ORDER BY dua_global_id`
    )
    .bind(bookId, chapId)
    .all<Omit<DuaListItem, "categories">>();

  if (results.length === 0) return c.json({ success: false, error: "No duas found for this chapter" }, 404);

  const duas: DuaDetail[] = await Promise.all(
    results.map(async (d) => ({
      ...d,
      categories: await getCategories(c.env.DB, d.dua_global_id),
      segments: await getSegments(c.env.DB, d.dua_global_id),
    }))
  );

  return c.json({ success: true, total: duas.length, data: duas });
});

// ── Random Dua (before :duaGlobalId to avoid conflict) ───────────────────────

app.get("/api/duas/random", async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
       FROM dua_names
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .first<Omit<DuaListItem, "categories">>();

  if (!row) return c.json({ success: false, error: "No duas found" }, 404);

  const [categories, segments] = await Promise.all([
    getCategories(c.env.DB, row.dua_global_id),
    getSegments(c.env.DB, row.dua_global_id),
  ]);

  return c.json({ success: true, data: { ...row, categories, segments } as DuaDetail });
});

// ── Individual Dua (full detail) ──────────────────────────────────────────────

app.get("/api/duas/:duaGlobalId", async (c) => {
  const id = parseInt(c.req.param("duaGlobalId"));
  if (isNaN(id)) return c.json({ success: false, error: "Invalid dua ID" }, 400);

  const row = await c.env.DB
    .prepare(
      `SELECT dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
       FROM dua_names
       WHERE dua_global_id = ?`
    )
    .bind(id)
    .first<Omit<DuaListItem, "categories">>();

  if (!row) return c.json({ success: false, error: "Dua not found" }, 404);

  const [categories, segments] = await Promise.all([
    getCategories(c.env.DB, id),
    getSegments(c.env.DB, id),
  ]);

  return c.json({ success: true, data: { ...row, categories, segments } as DuaDetail });
});

// ── Word-by-Word for a specific segment ───────────────────────────────────────

app.get("/api/duas/:duaGlobalId/segments/:segmentId/words", async (c) => {
  const duaId = parseInt(c.req.param("duaGlobalId"));
  const segId = parseInt(c.req.param("segmentId"));
  if (isNaN(duaId) || isNaN(segId)) return c.json({ success: false, error: "Invalid IDs" }, 400);

  const { results } = await c.env.DB
    .prepare(
      `SELECT word_id, arabic, bn
       FROM dua_wbw
       WHERE dua_global_id = ? AND dua_segment_id = ?
       ORDER BY word_id`
    )
    .bind(duaId, segId)
    .all<WordByWord>();

  return c.json({
    success: true,
    dua_global_id: duaId,
    dua_segment_id: segId,
    total: results.length,
    data: results,
  });
});

// ── Search (Bengali name/tags) ────────────────────────────────────────────────

app.get("/api/search", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q || q.length < 2) return c.json({ success: false, error: "Query must be at least 2 characters" }, 400);

  const { page, limit, offset } = paginate(new URL(c.req.url));
  const like = `%${q}%`;

  const countRow = await c.env.DB
    .prepare(`SELECT COUNT(*) as total FROM dua_names WHERE duaname LIKE ? OR chapname LIKE ? OR tags LIKE ?`)
    .bind(like, like, like)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await c.env.DB
    .prepare(
      `SELECT dua_global_id, book_id, chap_id, dua_id, chapname, duaname, tags, ID
       FROM dua_names
       WHERE duaname LIKE ? OR chapname LIKE ? OR tags LIKE ?
       ORDER BY dua_global_id
       LIMIT ? OFFSET ?`
    )
    .bind(like, like, like, limit, offset)
    .all<Omit<DuaListItem, "categories">>();

  const duas: DuaListItem[] = await Promise.all(
    results.map(async (d) => ({ ...d, categories: await getCategories(c.env.DB, d.dua_global_id) }))
  );

  return c.json({
    success: true,
    query: q,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    data: duas,
  });
});

// ── Search Arabic text ────────────────────────────────────────────────────────

app.get("/api/search/arabic", async (c) => {
  const q = c.req.query("q")?.trim();
  if (!q || q.length < 2) return c.json({ success: false, error: "Query must be at least 2 characters" }, 400);

  const { page, limit, offset } = paginate(new URL(c.req.url));
  const like = `%${q}%`;

  const countRow = await c.env.DB
    .prepare(
      `SELECT COUNT(DISTINCT d.dua_global_id) as total
       FROM dua_details d WHERE d.arabic LIKE ? OR d.arabic_diacless LIKE ?`
    )
    .bind(like, like)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await c.env.DB
    .prepare(
      `SELECT DISTINCT n.dua_global_id, n.book_id, n.chap_id, n.dua_id,
              n.chapname, n.duaname, n.tags, n.ID
       FROM dua_names n
       JOIN dua_details d ON n.dua_global_id = d.dua_global_id
       WHERE d.arabic LIKE ? OR d.arabic_diacless LIKE ?
       ORDER BY n.dua_global_id
       LIMIT ? OFFSET ?`
    )
    .bind(like, like, limit, offset)
    .all<Omit<DuaListItem, "categories">>();

  const duas: DuaListItem[] = await Promise.all(
    results.map(async (d) => ({ ...d, categories: await getCategories(c.env.DB, d.dua_global_id) }))
  );

  return c.json({
    success: true,
    query: q,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    data: duas,
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

app.notFound((c) => {
  return c.json(
    { success: false, error: "Route not found", hint: "Visit / for all available endpoints" },
    404
  );
});

export default app;
