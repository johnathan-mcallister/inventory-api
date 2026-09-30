import type { Asset, AssetEvent, InventoryQuery, InventoryRepository } from "./types.js";

const assets: Asset[] = [
  { id: "ast_01HQJ9K8WT", tenantId: "acme-it", assetTag: "ACME-1001", serialNumber: "C02ZQ0ABCD", name: "MacBook Pro 14", type: "laptop", manufacturer: "Apple", model: "MacBook Pro 14-inch", status: "active", location: "Auckland", assignedTo: "alex@example.com", tags: ["engineering", "managed"], purchasedAt: "2025-02-03", updatedAt: "2026-08-21T11:30:00.000Z" },
  { id: "ast_01HQJ9M2P3", tenantId: "acme-it", assetTag: "ACME-1002", serialNumber: "PF3AB9CD", name: "ThinkPad T14", type: "laptop", manufacturer: "Lenovo", model: "ThinkPad T14 Gen 5", status: "in_stock", location: "Wellington", tags: ["managed"], purchasedAt: "2025-06-14", updatedAt: "2026-08-17T09:00:00.000Z" }
];

const events: AssetEvent[] = [
  { id: "evt_001", assetId: "ast_01HQJ9K8WT", tenantId: "acme-it", occurredAt: "2026-08-21T11:30:00.000Z", action: "assigned", actor: "admin@example.com", detail: "Assigned to alex@example.com" },
  { id: "evt_002", assetId: "ast_01HQJ9K8WT", tenantId: "acme-it", occurredAt: "2025-02-03T12:00:00.000Z", action: "created", actor: "import-service", detail: "Imported from ITAM source" }
];

export class InMemoryInventoryRepository implements InventoryRepository {
  async listAssets(tenantId: string, query: InventoryQuery) {
    let rows = assets.filter((asset) => asset.tenantId === tenantId);
    if (query.type) rows = rows.filter((a) => a.type === query.type);
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.location) rows = rows.filter((a) => a.location === query.location);
    if (query.tag) rows = rows.filter((a) => a.tags.includes(query.tag!));
    if (query.search) {
      const text = query.search.toLowerCase();
      rows = rows.filter((a) => [a.name, a.assetTag, a.serialNumber, a.manufacturer, a.model].some((value) => value.toLowerCase().includes(text)));
    }
    rows.sort((a, b) => a.id.localeCompare(b.id));
    const start = query.cursor ? Math.max(0, rows.findIndex((a) => a.id === query.cursor) + 1) : 0;
    const page = rows.slice(start, start + query.limit);
    return { items: page, nextCursor: start + query.limit < rows.length ? page.at(-1)?.id : undefined };
  }

  async getAsset(tenantId: string, id: string) { return assets.find((asset) => asset.tenantId === tenantId && asset.id === id); }
  async getHistory(tenantId: string, assetId: string) {
    if (!assets.some((asset) => asset.tenantId === tenantId && asset.id === assetId)) return undefined;
    return events.filter((event) => event.tenantId === tenantId && event.assetId === assetId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }
  async listLocations(tenantId: string) { return [...new Set(assets.filter((a) => a.tenantId === tenantId).map((a) => a.location))].sort(); }
  async listCategories(tenantId: string) { return [...new Set(assets.filter((a) => a.tenantId === tenantId).map((a) => a.type))].sort(); }
}
