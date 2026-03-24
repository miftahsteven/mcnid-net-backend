import { FastifyInstance } from "fastify";
import { SnaController } from "./sna.controller";
import { authMiddleware, requireRole } from "../../middlewares/auth.middleware";

const snaController = new SnaController();

export async function snaRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/analyze",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    snaController.analyze
  );

  fastify.get(
    "/",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    snaController.listResults
  );

  fastify.get(
    "/:id",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    snaController.getResult
  );

  fastify.get(
    "/:id/insights",
    {
      preHandler: [authMiddleware, requireRole("SUPER_ADMIN", "ADMIN")],
    },
    snaController.getInsights
  );
}
