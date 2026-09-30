import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

process.env.JWT_SECRET = "test-secret-that-is-long-enough-for-jwt-signing";

async function authenticatedApp(tenantId = "acme-it", roles = ["inventory:read"]) {
  const app = await buildApp();
  const token = app.jwt.sign({ sub: "test-user", tenantId, roles });
  return { app, headers: { authorization: `Bearer ${token}` } };
}

test("inventory is protected and tenant scoped", async (t) => {
  const app = await buildApp();
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/v1/inventory" })).statusCode, 401);

  const token = app.jwt.sign({ sub: "other", tenantId: "other-tenant", roles: ["inventory:read"] });
  const response = await app.inject({ method: "GET", url: "/v1/inventory", headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, []);
});

test("lists and retrieves inventory", async (t) => {
  const { app, headers } = await authenticatedApp();
  t.after(() => app.close());
  const list = await app.inject({ method: "GET", url: "/v1/inventory?limit=1", headers });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().data.length, 1);
  const id = list.json().data[0].id;
  const asset = await app.inject({ method: "GET", url: `/v1/inventory/${id}`, headers });
  assert.equal(asset.statusCode, 200);
  assert.equal(asset.json().data.id, id);
});

test("rejects callers without inventory:read", async (t) => {
  const { app, headers } = await authenticatedApp("acme-it", ["other:read"]);
  t.after(() => app.close());
  assert.equal((await app.inject({ method: "GET", url: "/v1/inventory", headers })).statusCode, 403);
});
