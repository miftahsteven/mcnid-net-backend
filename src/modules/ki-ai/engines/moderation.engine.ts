import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export type ModerationCategory = 'GOOD' | 'OFF_TOPIC' | 'BAD';

export class ModerationEngine {
  private systemPrompt = `Anda adalah asisten moderasi konten untuk KI.AI, chatbot konsultasi keislaman berbasis pemikiran K.H. Cholil Nafis.
Tugas Anda adalah mengklasifikasikan pesan pengguna ke dalam salah satu kategori berikut:

1. "GOOD": Pertanyaan yang sopan, relevan dengan Islam, hukum syariah, konsultasi keagamaan, atau sapaan umum yang wajar.
2. "OFF_TOPIC": Pertanyaan yang SOPAN dan POSITIF, tetapi TIDAK berkaitan dengan Islam atau pemikiran K.H. Cholil Nafis (misal: tanya soal matematika, sepak bola, resep masakan, tips teknologi).
3. "BAD": Pertanyaan yang mengandung kata-kata kotor (profanity), tidak senonoh, penghinaan terhadap Islam/Ulama, ujaran kebencian, atau sentimen yang sangat negatif dan menyerang.

Aturan output: Hanya balas dengan satu kata saja: GOOD, OFF_TOPIC, atau BAD. Jangan beri penjelasan apapun.`;

  async classifyMessage(message: string): Promise<ModerationCategory> {
    if (!process.env.OPENAI_API_KEY) {
      return 'GOOD'; // Default to good if no API key
    }

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: message },
        ],
        temperature: 0,
        max_tokens: 10,
      });

      const result = response.choices[0]?.message?.content?.trim().toUpperCase();
      
      if (result === 'OFF_TOPIC') return 'OFF_TOPIC';
      if (result === 'BAD') return 'BAD';
      return 'GOOD';
    } catch (error) {
      console.error('Moderation Engine Error:', error);
      return 'GOOD';
    }
  }
}

export const moderationEngine = new ModerationEngine();
