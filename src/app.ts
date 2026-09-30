import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import helmet from "@fastify/helmet";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { InMemoryInventoryRepository } from "./repository.js";
import type { InventoryRepository } from "./types.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; tenantId: string; roles: string[] };
    user: { sub: string; tenantId: string; roles: string[] };
  }
}

const assetId = z.string().regex(/^ast_[A-Za-z0-9]+$/, "Invalid asset ID");
const listQuery = z.object({
  type: z.string().trim().min(1).max(80).optional(),
  status: z.enum(["active", "in_stock", "retired", "repair"]).optional(),
  location: z.string().trim().min(1).max(120).optional(),
  tag: z.string().trim().min(1).max(80).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: assetId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
});

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw Object.assign(new Error("Invalid request"), { statusCode: 400, issues: result.error.flatten() });
  return result.data;
}

function requireRole(request: FastifyRequest, role: string) {
  if (!request.user.roles.includes(role)) throw Object.assign(new Error("Insufficient permissions"), { statusCode: 403 });
}

export async function buildApp(repository: InventoryRepository = new InMemoryInventoryRepository()): Promise<FastifyInstance> {
  const app = Fastify({ logger: { redact: ["req.headers.authorization", "req.body.password", "reply.headers.set-cookie"] } });
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters");

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  await app.register(jwt, { secret });

  app.setErrorHandler((error, request, reply) => {
    request.log.warn({ err: error, requestId: request.id }, "Request failed");
    const known = error as Error & { statusCode?: number; issues?: unknown };
    const statusCode = known.statusCode && known.statusCode >= 400 ? known.statusCode : 500;
    reply.code(statusCode).send({ error: statusCode === 500 ? "Internal server error" : known.message, requestId: request.id, ...(known.issues ? { details: known.issues } : {}) });
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.addHook("onRequest", async (request) => {
    if (!request.url.startsWith("/v1/") || request.url === "/v1/dev/token") return;
    await request.jwtVerify();
    requireRole(request, "inventory:read");
  });

  app.get("/v1/inventory", async (request) => {
    const parsed = parse(listQuery, request.query);
    const query = { ...parsed, limit: parsed.limit ?? 25 };
    const result = await repository.listAssets(request.user.tenantId, query);
    return { data: result.items, page: { limit: query.limit, nextCursor: result.nextCursor ?? null } };
  });

  app.get("/v1/inventory/:assetId", async (request, reply) => {
    const { assetId: id } = parse(z.object({ assetId }), request.params);
    const asset = await repository.getAsset(request.user.tenantId, id);
    if (!asset) return reply.code(404).send({ error: "Asset not found", requestId: request.id });
    return { data: asset };
  });

  app.get("/v1/inventory/:assetId/history", async (request, reply) => {
    const { assetId: id } = parse(z.object({ assetId }), request.params);
    const history = await repository.getHistory(request.user.tenantId, id);
    if (!history) return reply.code(404).send({ error: "Asset not found", requestId: request.id });
    return { data: history };
  });

  app.get("/v1/locations", async (request) => ({ data: await repository.listLocations(request.user.tenantId) }));
  app.get("/v1/categories", async (request) => ({ data: await repository.listCategories(request.user.tenantId) }));

  if (process.env.NODE_ENV !== "production") {
    app.post("/v1/dev/token", async (request, reply) => {
      const body = parse(z.object({ subject: z.string().min(1).max(120), tenantId: z.string().min(1).max(120), roles: z.array(z.string().min(1).max(80)).min(1).max(10) }), request.body);
      const token = await reply.jwtSign({ sub: body.subject, tenantId: body.tenantId, roles: body.roles }, { expiresIn: "15m" });
      return { token, expiresIn: "15m" };
    });
  }
  return app;
}
