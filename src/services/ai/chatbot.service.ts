import { prisma } from '../../lib/prisma';
import OpenAI from 'openai';
import { detectPromptInjection, sanitizePlainText } from '../../middlewares/sanitize';
import { knowledgeEngine } from '../../modules/ki-ai/engines/knowledge.engine';
import { externalEngine } from '../../modules/ki-ai/engines/external.engine';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
Anda adalah KI.AI, asisten virtual resmi K.H. Cholil Nafis — seorang ulama, 
cendekiawan Muslim, dan akademisi terkemuka Indonesia yang selaras dengan Majelis Ulama Indonesia (MUI).

Tugasmu adalah menjawab pertanyaan pengunjung seputar:
- Profil dan riwayat beliau
- Pandangan keislaman (fiqh, ushul fiqh, ekonomi syariah)
- Berita dan kegiatan dakwah terkini (terutama fatwa-fatwa terbaru MUI)
- Karya tulis dan publikasi ilmiah

ATURAN KETAT DAN PRIORITAS:
1. PRIORITAS UTAMA: Gunakan data [KONTEKS INTERNAL] yang berisi pemikiran MURNI K.H. Cholil Nafis.
2. PRIORITAS KEDUA: Gunakan data [KONTEKS EKSTERNAL] dari MUI atau NU. Dahulukan pandangan MUI untuk menjaga keselarasan fatwa.
3. JANGAN JAWAB dari pengetahuan umum internet jika bertentangan dengan rujukan yang diberikan.
4. PERHATIKAN FATWA KRUSIAL: Contohnya, Fatwa MUI menyatakan penyembelihan Dam haji di luar Tanah Haram adalah TIDAK SAH. Jangan sampai memberikan informasi yang salah mengenai hal-benar ritual seperti ini.
5. Jawab dengan bahasa Indonesia yang sopan, santun, dan moderat (Wasathiyah).
6. Hindari topik politik praktis, sara, atau provokatif.
7. Jika tidak ada rujukan spesifik dalam [KONTEKS] namun pertanyaan berkaitan dengan prinsip dasar keislaman yang umum (seperti dalil-dalil Al-Qur'an dan Hadits yang masyhur), Anda diperbolehkan menjawab berdasarkan pengetahuan keislaman yang otoritatif (Wasathiyah) sambil tetap menjaga keselarasan dengan pemikiran beliau.
8. Jangan menyebutkan nama situs rujukan (seperti "mui.or.id") di dalam kalimat jawaban.
9. Maksimal jawaban 500 kata.
10. Jika pertanyaan user bersifat tindak lanjut (seperti "apa dalilnya?", "siapa itu?"), hubungkan dengan konteks pembicaraan sebelumnya agar jawaban tetap sinkron dan dinamis.
`.trim();

/**
 * Generate embedding vector from text using OpenAI
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  });
  return response.data[0].embedding;
}

/**
 * Find relevant knowledge base entries using vector similarity search
 * Note: requires pgvector extension and vector column in knowledge_base table
 * For now, falls back to text-based keyword matching until pgvector is set up
 */
async function retrieveRelevantContext(question: string): Promise<string> {
  // 1. Get from Internal Knowledge (KiAiKnowledge)
  const internalData = await knowledgeEngine.search(question, 5);

  // 2. Get from External Knowledge (MUI/NU)
  const externalData = await externalEngine.search(question, 3);

  // 3. Get from Legacy KnowledgeBase (Optional fallback)
  const legacyKnowledge = await prisma.knowledgeBase.findMany({
    where: { active: true },
    select: { title: true, content: true },
    take: 3,
  });

  let context = '[KONTEKS INTERNAL]\n';
  if (internalData.length > 0) {
    context += internalData.map(d => `Judul: ${d.title}\nIsi: ${d.content}`).join('\n\n');
  } else {
    context += 'Tidak ada data internal spesifik.';
  }

  context += '\n\n[KONTEKS EKSTERNAL (MUI/NU)]\n';
  if (externalData.length > 0) {
    context += externalData.map(d => `Judul: ${d.title}\nIsi: ${d.snippet}\nSumber: ${d.url}`).join('\n\n');
  } else {
    context += 'Tidak ada data eksternal spesifik.';
  }

  if (legacyKnowledge.length > 0) {
    context += '\n\n[KONTEKS TAMBAHAN]\n';
    context += legacyKnowledge.map(d => `${d.title}: ${d.content}`).join('\n\n');
  }

  return context;
}

/**
 * Refine question based on previous context if related
 */
async function refineQuestionWithContext(question: string, history: { question: string; answer: string }[]): Promise<string> {
  if (history.length === 0) return question;

  const historyText = history.map(h => `User: ${h.question}\nAI: ${h.answer}`).join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Tugas Anda adalah menganalisis apakah pertanyaan terbaru user merupakan tindak lanjut (follow-up) atau berkaitan dengan percakapan sebelumnya.
        
        Instruksi:
        1. Jika pertanyaan sangat singkat (seperti "apa dalilnya?", "kenapa?", "siapa beliau?") atau menggunakan kata ganti (ia, itu, tersebut), tulis ulang menjadi pertanyaan mandiri yang lengkap dan deskriptif.
        2. Masukkan konteks spesifik dari percakapan sebelumnya (topik, nama tokoh, hukum yang dibahas) ke dalam pertanyaan baru tersebut.
        3. Jika pertanyaan sudah lengkap atau tidak berkaitan dengan sejarah, kembalikan pertanyaan asli.
        4. Hasil akhir harus berupa pertanyaan yang bisa dipahami oleh orang yang tidak membaca sejarah chat.
        
        Penting: Hanya berikan teks pertanyaan akhirnya saja, jangan ada penjelasan tambahan.`
      },
      {
        role: 'user',
        content: `Sejarah Chat:\n${historyText}\n\nPertanyaan Terbaru: ${question}`
      }
    ],
    max_tokens: 200,
    temperature: 0,
  });

  const refined = response.choices[0]?.message?.content?.trim() || question;
  console.log(`[Chatbot] Refined Question: "${question}" -> "${refined}"`);
  return refined;
}

interface ChatbotInput {
  question: string;
  sessionId: string;
  ipHash?: string;
}

interface ChatbotOutput {
  answer: string;
  sessionId: string;
  tokens?: number;
}

export async function processChatbotQuestion(input: ChatbotInput): Promise<ChatbotOutput> {
  const cleanQuestion = sanitizePlainText(input.question);

  // Prompt injection check
  if (detectPromptInjection(cleanQuestion)) {
    return { answer: 'Maaf, pertanyaan Anda tidak dapat diproses.', sessionId: input.sessionId };
  }

  // 1. Daily Limit Check (5 questions per user per day)
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const dailyCount = await prisma.chatLog.count({
    where: {
      AND: [
        { createdAt: { gte: startOfDay } },
        {
          OR: [
            { sessionId: input.sessionId },
            ...(input.ipHash ? [{ ipHash: input.ipHash }] : []),
          ],
        },
      ],
    },
  });

  if (dailyCount >= 5) {
    return {
      answer: 'Mohon maaf, Anda telah mencapai batas maksimal 5 pertanyaan per hari. Silakan kembali lagi besok. Terima kasih atas pengertiannya.',
      sessionId: input.sessionId
    };
  }

  // 2. Fetch Chat History
  const historyLogs = await prisma.chatLog.findMany({
    where: { sessionId: input.sessionId },
    orderBy: { createdAt: 'desc' },
    take: 3,
  });

  const history = historyLogs.reverse().map(h => ({
    question: h.question,
    answer: h.answer
  }));

  // 3. Refine question based on history (Context awareness)
  const refinedQuestion = history.length > 0
    ? await refineQuestionWithContext(cleanQuestion, history)
    : cleanQuestion;

  // 4. Retrieve Context based on refined question
  const context = await retrieveRelevantContext(refinedQuestion);

  // 5. Final LLM Response
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
  ];

  // Add history to messages for true conversational experience
  history.forEach(h => {
    messages.push({ role: 'user', content: h.question });
    messages.push({ role: 'assistant', content: h.answer });
  });

  messages.push({
    role: 'user',
    content: `[KONTEKS]\n${context}\n\n[PERTANYAAN]\n${cleanQuestion}`,
  });

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 400,
    messages,
  });

  let answer = completion.choices[0]?.message?.content || 'Maaf, saya tidak dapat memberikan jawaban saat ini.';
  const tokens = completion.usage?.total_tokens;

  // 6. Append Donation Appeal (Randomly shown starting from the 2nd question)
  const currentDailyCount = dailyCount + 1;
  const currentSessionCount = historyLogs.length + 1;

  // Show if:
  // - It's the 2nd or 3rd question of the day
  // - OR it's the 2nd or 3rd question of the session
  // - OR a 30% random chance starting from the 2nd question
  const shouldShowDonation =
    (currentDailyCount === 2 || currentDailyCount === 3) ||
    (currentSessionCount === 2 || currentSessionCount === 3) ||
    (currentDailyCount >= 2 && Math.random() < 0.3);

  if (shouldShowDonation) {
    const donationText = '\n\nDemi kelanjutan dakwah digital dan mudah diakses, silahkan salurkan infaq dan zakat terbaik anda melalui Amanah Zakat. Salurkan melalui tautan berikut: https://amanahzakat.id/program/27. Terima kasih.';
    answer += donationText;
  }

  // Log to database
  await prisma.chatLog.create({
    data: {
      sessionId: input.sessionId,
      question: cleanQuestion,
      answer,
      ipHash: input.ipHash,
      tokens: tokens ?? null,
    },
  });

  return { answer, sessionId: input.sessionId, tokens };
}
