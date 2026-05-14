import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || '',
});

export class RefinementEngine {
  async refineQuestion(question: string, history: { question: string; answer: string }[]): Promise<string> {
    if (history.length === 0) return question;

    const historyText = history.map(h => `User: ${h.question}\nAI: ${h.answer}`).join('\n');
    
    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `Tugas Anda adalah memastikan setiap pertanyaan user memiliki konteks yang lengkap sebelum diproses oleh mesin pencari.
            
            Instruksi Penting:
            1. Analisis apakah pertanyaan terbaru user bersifat ambigu, sangat singkat, atau bergantung pada konteks sebelumnya (misal: "apa dalilnya?", "siapa?", "berapa harganya?", "bolehkah?", "dibayar di mana?").
            2. Jika ya, tulis ulang pertanyaan tersebut menjadi pertanyaan mandiri yang lengkap dengan menyertakan detail dari sejarah chat (subjek, topik, atau benda yang sedang dibahas).
            3. Contoh: 
               - Chat: Bahas tentang Dam Haji. User: "Boleh dibayar di Indonesia?" -> Hasil: "Apakah Dam Haji boleh dibayar di Indonesia?"
               - Chat: Bahas tentang hukum kripto. User: "Apa dalilnya?" -> Hasil: "Apa dalil Al-Qur'an atau Hadits mengenai hukum kripto?"
            4. Jika pertanyaan sudah jelas dan tidak butuh konteks tambahan, kembalikan pertanyaan asli.
            5. Hanya berikan teks pertanyaan akhirnya saja.`
          },
          {
            role: 'user',
            content: `Sejarah Chat:\n${historyText}\n\nPertanyaan Terbaru: ${question}`
          }
        ],
        max_tokens: 200,
        temperature: 0,
      });

      return response.choices[0]?.message?.content?.trim() || question;
    } catch (error) {
      console.error('Refinement error:', error);
      return question;
    }
  }
}

export const refinementEngine = new RefinementEngine();
