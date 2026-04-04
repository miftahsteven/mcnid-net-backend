📄 PRD.md — KI.AI Middleware (Core AI Engine)
1. Overview
Nama Produk: KI.AI
ROUTES: ki-ai/* 
Fitur: Konsultasi keislaman berbasis pemikiran KH. Cholil Nafis
Tujuan Middleware:
- Mengelola logika AI
- Mengambil data internal knowledge base
- Mengambil referensi eksternal (MUI / NU)
- Mengontrol response dari OpenAI
- Menjaga akurasi & sumber jawaban

Middleware ini adalah otak utama dari KI.AI.

2. Objectives
Primary Goals
- Menjawab pertanyaan user dengan:
  - Prioritas: knowledge internal
  - Secondary: referensi eksternal (MUI/NU)
- Memberikan jawaban yang:
  - Terstruktur
  - Tidak halusinasi
  - Memiliki sumber
Secondary Goals
- Logging & analytics pertanyaan
- Feedback loop untuk improvement
- Scalability untuk RAG (embedding)

3. High-Level Architecture
Frontend (Next.js)
        ↓
Backend API (MCN)
        ↓
KI.AI Middleware (Node.js)
        ↓
-----------------------------
| Internal KB (PostgreSQL) |
| External Source (Scraper/API MUI/NU) |
| OpenAI API               |
-----------------------------

4. Core Components (Middleware)
4.1 Chat Controller
Endpoint utama:

POST /ki-ai/chat

4.2 Knowledge Engine
- Search internal KB
- Scoring relevance
- Chunk selection

4.3 External Retrieval Engine
Fetch dari:
- mui.or.id
- nu.or.id
Filter domain whitelist

4.4 AI Response Engine
- Build prompt
- Call OpenAI
- Format output

4.5 Decision Engine (Paling penting)
Menentukan:
- Internal only
- Internal + external
- External only
- No answer mode

5. Detailed Flow (WAJIB DIPAHAMI)
Step-by-step flow:

1. User kirim pertanyaan
2. Middleware menerima request
3. Preprocess pertanyaan
4. Search internal knowledge
5. Hitung relevance score
6. Decision engine memilih mode
7. Ambil data (internal/external)
8. Build prompt
9. Call OpenAI
10. Format response
11. Return ke frontend
12. Simpan log

6. Decision Engine Logic
Scoring Rule

| Score     | Action              |
| --------- | ------------------- |
| > 0.75    | Internal only       |
| 0.45–0.75 | Internal + External |
| < 0.45    | External only       |
| No data   | No answer           |

Mode Detail
Mode A — Internal Strong
- Gunakan hanya data internal
- Label: "Berdasarkan basis pengetahuan KI.AI"

Mode B — Hybrid
- Internal + MUI/NU
- Tambahkan referensi

Mode C — External Only
- Tidak ada data internal
- Tampilkan link resmi

Mode D — No Answer
- Tidak ada sumber valid
- Response aman (tidak halusinasi)

7. API Specification
7.1 POST /ki-ai/chat
Request
{
  "message": "Apa hukum riba dalam Islam?",
  "session_id": "uuid",
  "user_id": "optional"
}

Response
{
  "answer": "...",
  "mode": "internal | hybrid | external | none",
  "sources": [
    {
      "type": "internal",
      "title": "...",
      "url": null
    },
    {
      "type": "mui",
      "title": "...",
      "url": "https://mui.or.id/..."
    }
  ],
  "confidence": 0.82
}

8. Internal Knowledge Base Structure
Table: kb_articles
- id
- title
- content
- category
- source_type (internal/mui/nu)
- source_url
- author
- created_at

Table: kb_chunks
- id
- article_id
- chunk_text
- keywords
- (future) embedding

9. Internal Search (Phase 1)
Gunakan:
- PostgreSQL Full Text Search
Query:
to_tsvector(content) @@ plainto_tsquery(query)

Ranking:
- ts_rank
- keyword matching
- category boost

10. External Retrieval
Strategy:
- Scrape ringan / API
- Hanya domain:
  - mui.or.id
  - nu.or.id
Output:
- title
- snippet
- url

11. Prompt Engineering (CRITICAL)
System Prompt :

Anda adalah KI.AI, asisten keislaman berbasis pemikiran KH Cholil Nafis.

ATURAN:
- Prioritaskan informasi dari basis pengetahuan internal
- Jika tidak cukup, gunakan referensi eksternal yang diberikan
- Jangan membuat fatwa baru
- Jika tidak yakin, katakan tidak cukup data
- Jawaban harus sopan, jelas, dan tidak menghakimi
- Sertakan sumber jika ada

Input Prompt Structure
[PERTANYAAN USER]

[CONTEXT INTERNAL]
...

[CONTEXT EXTERNAL]
...

[INSTRUKSI]
Jawab berdasarkan prioritas internal knowledge.

12. OpenAI Integration
Gunakan:
- Responses API (recommended)
- Streaming ON (untuk UX seperti ChatGPT)

13. Logging & Analytics
Table: chat_logs
- id
- question
- answer
- mode
- confidence
- created_at

Table: chat_sources
- chat_id
- source_type
- source_url

Table: feedback
- chat_id
- is_helpful (boolean)

14. Safety Layer
Rules:
- Tidak boleh generate hukum tanpa sumber
- Tidak boleh menjawab jika confidence rendah
- Harus tampilkan disclaimer jika perlu

15. Performance Consideration
- Cache query populer
- Limit chunk retrieval (max 5)
- Debounce user request
- Timeout OpenAI

16. Future Enhancement (Phase 2)
RAG Upgrade
- pgvector
- embedding search
- hybrid search

Agent Mode
- tool calling:
  - searchInternal
  - searchMUI
  - searchNU

17. Non-Functional Requirements
Performance
- Response < 2.5 detik
Scalability
- Stateless middleware
- Horizontal scaling ready
Security
- Rate limit
- API key protection
- Sanitization input

18. Success Metrics
- Accuracy (manual review)
- % jawaban dari internal
- User satisfaction
- Bounce rate chat

19. Implementation Roadmap
Week 1
- Endpoint chat
- Internal search
- Basic OpenAI

Week 2
- Decision engine
- External retrieval
- Logging

Week 3
- Streaming
- UI improvement
- Feedback loop

Week 4
- Optimization
- Scoring tuning
- Production hardening