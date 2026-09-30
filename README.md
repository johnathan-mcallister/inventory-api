# Inventory API

Secure, tenant-scoped read API for exposing IT asset-management (ITAM) data.

## Run

```sh
npm install
copy .env.example .env
npm run dev
```

For development, obtain a short-lived token (only enabled when `NODE_ENV` is not `production`):

```sh
curl -X POST http://127.0.0.1:3000/v1/dev/token -H "content-type: application/json" -d "{\"subject\":\"alice\",\"tenantId\":\"acme-it\",\"roles\":[\"inventory:read\"]}"
```

Use the returned token with `Authorization: Bearer <token>`.

## Endpoints

 * GET /health
    * Use case: Check whether the API is running and healthy.
    * Authentication: None
    * Example: Used by Docker, monitoring systems, load balancers, or deployment checks.
 * GET /v1/inventory
    * Use case: Retrieve a paginated list of inventory assets.
    * Authentication: JWT required with inventory:read role.
    * Supports filtering by:
    * type - Filter by asset type
    * status - active, in_stock, retired, or repair
    * location - Filter by physical location
    * tag - Filter by asset tag
    * search - General asset search
    * cursor - Retrieve the next page
    * limit - Number of results, 1-100, default 25
    * Example use case: An inventory dashboard displaying all active devices at a particular school.
 * GET /v1/inventory/{assetId}
    * Use case: Retrieve detailed information about a specific asset.
    * Authentication: JWT required with inventory:read role.
    * Example: Look up a specific laptop, Chromebook, desktop, or other tracked asset using an ID such as ast_12345.
 * GET /v1/inventory/{assetId}/history
    * Use case: Retrieve the historical records associated with an asset.
    * Authentication: JWT required with inventory:read role.
    * Example: View an asset's previous locations, status changes, repairs, or other historical events.
 * GET /v1/locations
    * Use case: Retrieve the locations associated with inventory for the authenticated tenant.
    * Authentication: JWT required with inventory:read role.
    * Example: Populate a location filter/dropdown in an inventory management application.
 * GET /v1/categories
    * Use case: Retrieve the available inventory categories.
    * Authentication: JWT required with inventory:read role.
    * Example: Populate an asset-type/category filter when searching or creating inventory views.
 * POST /v1/dev/token
    * Use case: Generate a temporary JWT for development and testing.
    * Authentication: None.
    * Availability: Only available when NODE_ENV is not production.
    * Token expiration: 15 minutes.
    * Request includes:
    * subject - User identifier
    * tenantId - Tenant the user belongs to
    * roles - User roles, such as inventory:read
    * Example: Generate a test token for Postman or local development without needing a full authentication system.
