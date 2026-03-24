import { FastifyRequest, FastifyReply } from "fastify";
import { SnaService } from "./sna.service";

const snaService = new SnaService();

export class SnaController {
  /**
   * Run Analysis (POST)
   */
  async analyze(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { keyword, limit = 100 } = request.body as { keyword: string; limit?: number };
      
      if (!keyword) {
        return reply.status(400).send({ error: "Keyword atau URL diperlukan" });
      }

      const result = await snaService.runAnalysis(keyword, limit);
      return reply.status(200).send(result);
    } catch (error: any) {
      console.error("[SNA Controller] Analysis Error:", error);
      return reply.status(500).send({ 
        error: "Gagal menjalankan analisis SNA", 
        message: error.message 
      });
    }
  }

  /**
   * Get Result (GET)
   */
  async getResult(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const result = await snaService.getResult(id);
      
      if (!result) {
        return reply.status(404).send({ error: "Analisis tidak ditemukan" });
      }

      return reply.status(200).send(result);
    } catch (error: any) {
      console.error("[SNA Controller] Get Result Error:", error);
      return reply.status(500).send({ error: "Gagal mengambil data analisis" });
    }
  }

  /**
   * Get Insights (GET)
   */
  async getInsights(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const result = await snaService.getResult(id);
      
      if (!result) {
        return reply.status(404).send({ error: "Analisis tidak ditemukan" });
      }

      // Return simplified analytics and insights
      return reply.status(200).send({
        keyword: result.keyword,
        analytics: result.analytics,
        timestamp: result.createdAt,
      });
    } catch (error: any) {
      console.error("[SNA Controller] Get Insights Error:", error);
      return reply.status(500).send({ error: "Gagal mengambil insights" });
    }
  }

  /**
   * List all Results (GET)
   */
  async listResults(request: FastifyRequest, reply: FastifyReply) {
    try {
      const results = await snaService.listResults();
      return reply.status(200).send(results);
    } catch (error: any) {
      console.error("[SNA Controller] List Results Error:", error);
      return reply.status(500).send({ error: "Gagal mengambil daftar analisis" });
    }
  }
}
