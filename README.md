# 📿 Hisnul Muslim Dua API

> A free, open-source REST API for **Hisnul Muslim** (হিসনুল মুসলিম) — delivering authentic duas in **Arabic**, **Bengali transliteration**, and **word-by-word breakdown**, powered by Cloudflare Workers + D1.

🌐 **Live API:** [`https://dua-api.hisnul.workers.dev/`](https://dua-api.hisnul.workers.dev/)

---

## ✨ Features

- 📖 **421 authentic duas** from Hisnul Muslim, Quranic duas, and special adhkar
- 🕌 **Full Arabic text** with and without diacritics (tashkeel)
- 🇧🇩 **Bengali translations** for every dua and segment
- 🔤 **Word-by-word breakdown** (Arabic ↔ Bengali) for deep understanding
- 🗂️ **18 topic categories** (Sleep, Morning/Evening, Family, Health, Travel, and more)
- 📚 **3 books** with **218 chapters**
- 🔍 **Full-text search** in Bengali names, tags, and Arabic text
- 🎲 **Random dua** endpoint for daily reminders
- ⚡ **Globally fast** — deployed on Cloudflare's edge network
- 🔓 **Free & open** — no API key required, CORS enabled

---

## 🚀 Quick Start

```bash
# Get all categories
curl https://dua-api.hisnul.workers.dev/api/categories

# Get a specific dua with full Arabic text and word-by-word
curl https://dua-api.hisnul.workers.dev/api/duas/2

# Search for a dua
curl "https://dua-api.hisnul.workers.dev/api/search?q=ঘুম"

# Get a random dua
curl https://dua-api.hisnul.workers.dev/api/duas/random
```

---

## 📡 API Reference

**Base URL:** `https://dua-api.hisnul.workers.dev`

All responses follow this structure:
```json
{
  "success": true,
  "data": { ... }
}
```

---

### Categories

#### `GET /api/categories`
Returns all 18 topic categories with dua counts.

```bash
curl https://dua-api.hisnul.workers.dev/api/categories
```

```json
{
  "success": true,
  "total": 18,
  "data": [
    { "id": 1, "name": "ঘুম", "dua_count": 18 },
    { "id": 2, "name": "সকাল - সন্ধ্যা", "dua_count": 24 }
  ]
}
```

#### `GET /api/categories/:id`
Single category with dua count.

#### `GET /api/categories/:id/duas`
All duas belonging to a category. Supports pagination.

```bash
curl "https://dua-api.hisnul.workers.dev/api/categories/1/duas?page=1&limit=10"
```

---

### Books

#### `GET /api/books`
All 3 books with chapter and dua counts.

```bash
curl https://dua-api.hisnul.workers.dev/api/books
```

```json
{
  "success": true,
  "data": [
    { "book_id": 1, "name": "হিসনুল মুসলিম", "chapter_count": 133, "dua_count": 312 },
    { "book_id": 2, "name": "কুরআনের দোয়াসমূহ", "chapter_count": 77, "dua_count": 77 },
    { "book_id": 3, "name": "বিশেষ যিকর ও দোয়া", "chapter_count": 9, "dua_count": 32 }
  ]
}
```

#### `GET /api/books/:bookId`
Single book details.

#### `GET /api/books/:bookId/chapters`
All chapters of a book with dua counts.

```bash
curl https://dua-api.hisnul.workers.dev/api/books/1/chapters
```

#### `GET /api/books/:bookId/chapters/:chapId`
Single chapter details.

#### `GET /api/books/:bookId/duas`
All duas in a book. Paginated.

```bash
curl "https://dua-api.hisnul.workers.dev/api/books/1/duas?page=2&limit=20"
```

#### `GET /api/books/:bookId/chapters/:chapId/duas`
**All duas in a chapter — including full Arabic segments and word-by-word.** This is the primary endpoint for building a chapter/detail screen in an app.

```bash
curl https://dua-api.hisnul.workers.dev/api/books/1/chapters/1/duas
```

```json
{
  "success": true,
  "total": 4,
  "data": [
    {
      "dua_global_id": 2,
      "book_id": 1,
      "chap_id": 1,
      "duaname": "ঘুম থেকে জেগে উঠার সময়ের যিক্‌রসমূহ #১",
      "categories": [{ "id": 1, "name": "ঘুম" }],
      "segments": [
        {
          "dua_segment_id": 1,
          "arabic": "الْحَمْدُ لِلَّهِ الَّذِي أَحْيَانَا بَعْدَ مَا أَمَاتَنَا",
          "translations": "সমস্ত প্রশংসা আল্লাহর, যিনি আমাদের মৃত্যু দেওয়ার পর আবার জীবিত করলেন",
          "reference": "সহীহ বুখারী",
          "words": [
            { "word_id": 0, "arabic": "الْحَمْدُ", "bn": "সমস্ত প্রশংসা" },
            { "word_id": 1, "arabic": "لِلَّهِ", "bn": "আল্লাহর জন্য" }
          ]
        }
      ]
    }
  ]
}
```

---

### Individual Duas

#### `GET /api/duas/:duaGlobalId`
Full dua detail — metadata, all segments (Arabic + translation + reference), and word-by-word breakdown.

```bash
curl https://dua-api.hisnul.workers.dev/api/duas/2
```

#### `GET /api/duas/random`
A random dua with full detail. Great for daily reminders and widgets.

```bash
curl https://dua-api.hisnul.workers.dev/api/duas/random
```

#### `GET /api/duas/:duaGlobalId/segments/:segmentId/words`
Word-by-word breakdown for a specific segment only.

```bash
curl https://dua-api.hisnul.workers.dev/api/duas/2/segments/1/words
```

---

### Search

#### `GET /api/search?q=query`
Search duas by Bengali name, chapter name, or tags.

```bash
curl "https://dua-api.hisnul.workers.dev/api/search?q=ঘুম"
curl "https://dua-api.hisnul.workers.dev/api/search?q=সালাত"
```

#### `GET /api/search/arabic?q=query`
Search by Arabic text — works with or without diacritics.

```bash
curl "https://dua-api.hisnul.workers.dev/api/search/arabic?q=الله"
curl "https://dua-api.hisnul.workers.dev/api/search/arabic?q=بسم"
```

---

### Pagination

All list endpoints support:

| Parameter | Default | Max | Description |
|-----------|---------|-----|-------------|
| `page` | `1` | — | Page number |
| `limit` | `20` | `100` | Results per page |

```bash
curl "https://dua-api.hisnul.workers.dev/api/books/1/duas?page=3&limit=50"
```

Paginated responses include:
```json
{
  "pagination": {
    "page": 3,
    "limit": 50,
    "total": 312,
    "pages": 7
  }
}
```

---

## 🗄️ Database Schema

```
category           — 18 topic categories
dua_names          — 421 duas (metadata, names, tags)
dua_name_category  — many-to-many: duas ↔ categories
dua_details        — Arabic text, translations, references per segment
dua_wbw            — word-by-word Arabic ↔ Bengali breakdown
```

A single dua can belong to **multiple categories** (e.g. a dua for a sick child belongs to both "Family" and "Health"). This is handled via the `dua_name_category` junction table.

---

## 🛠️ Self-Hosting

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)

### 1. Clone & Install

```bash
git clone https://github.com/YOUR_USERNAME/dua-api.git
cd dua-api
npm install
```

### 2. Authenticate with Cloudflare

```bash
npx wrangler login
```

### 3. Create your D1 Database

```bash
npx wrangler d1 create hisnulbd
```

Copy the `database_id` from the output and update `wrangler.jsonc`:

```jsonc
{
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "hisnulbd",
      "database_id": "YOUR_DATABASE_ID_HERE"
    }
  ]
}
```

### 4. Upload CSV Data

Place the CSV files in the project root, then run:

```bash
npm run upload
```

This uploads all 4 CSV files (`category.csv`, `duanames.csv`, `duadetails.csv`, `duawbw.csv`) into D1 with automatic size-based batching.

### 5. Deploy

```bash
npm run deploy
```

Your API will be live at `https://dua-api.YOUR_SUBDOMAIN.workers.dev/`

### Local Development

```bash
npm run dev
# → http://localhost:8787
```

---

## 📁 Project Structure

```
dua-api/
├── src/
│   └── index.ts          # All API routes (Hono)
├── upload-to-d1.js       # CSV → D1 upload script
├── wrangler.jsonc         # Cloudflare Workers config
├── package.json
└── tsconfig.json
```

---

## 🧰 Tech Stack

| Layer | Technology |
|---|---|
| Runtime | [Cloudflare Workers](https://workers.cloudflare.com/) |
| Framework | [Hono](https://hono.dev/) |
| Database | [Cloudflare D1](https://developers.cloudflare.com/d1/) (SQLite at the edge) |
| Language | TypeScript |
| Data Upload | Node.js + [csv-parse](https://csv.js.org/parse/) |

---

## 📊 Data Coverage

| Resource | Count |
|---|---|
| Books | 3 |
| Chapters | 218 |
| Duas | 421 |
| Categories | 18 |
| Dua segments | 578 |
| Word-by-word entries | 5,806 |

---

## 🤝 Contributing

Contributions are welcome! If you find a translation error, missing dua, or want to add a new language:

1. Fork the repository
2. Create a feature branch: `git checkout -b fix/translation-correction`
3. Commit your changes: `git commit -m 'fix: correct translation for dua #42'`
4. Push and open a Pull Request

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

The dua content is from **Hisnul Muslim** (حصن المسلم) by Sheikh Sa'eed ibn Ali ibn Wahf Al-Qahtani, which is in the public domain.

---

## 🙏 Acknowledgements

- **Hisnul Muslim** — the original source of all duas
- [Cloudflare Workers](https://workers.cloudflare.com/) — for free global edge hosting
- [Hono](https://hono.dev/) — lightweight and fast web framework for Workers

---

<p align="center">
  Made with ❤️ for the Muslim community
  <br/>
  <a href="https://dua-api.hisnul.workers.dev/">Live API</a> •
  <a href="https://dua-api.hisnul.workers.dev/api/duas/random">Random Dua</a> •
  <a href="https://dua-api.hisnul.workers.dev/api/categories">Browse Categories</a>
</p>
