export type AssetStatus = "active" | "in_stock" | "retired" | "repair";

export interface Asset {
  id: string;
  tenantId: string;
  assetTag: string;
  serialNumber: string;
  name: string;
  type: string;
  manufacturer: string;
  model: string;
  status: AssetStatus;
  location: string;
  assignedTo?: string;
  tags: string[];
  purchasedAt?: string;
  updatedAt: string;
}

export interface AssetEvent {
  id: string;
  assetId: string;
  tenantId: string;
  occurredAt: string;
  action: "created" | "assigned" | "status_changed" | "updated";
  actor: string;
  detail: string;
}

export interface InventoryQuery {
  type?: string;
  status?: AssetStatus;
  location?: string;
  tag?: string;
  search?: string;
  cursor?: string;
  limit: number;
}

export interface InventoryRepository {
  listAssets(tenantId: string, query: InventoryQuery): Promise<{ items: Asset[]; nextCursor?: string }>;
  getAsset(tenantId: string, id: string): Promise<Asset | undefined>;
  getHistory(tenantId: string, assetId: string): Promise<AssetEvent[] | undefined>;
  listLocations(tenantId: string): Promise<string[]>;
  listCategories(tenantId: string): Promise<string[]>;
}
