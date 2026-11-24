# Community Outreach Technology Loan API

Fastify/TypeScript API for tenant-scoped outreach centers, devices, loans, loan reasons, and maintenance. JSON fields use camelCase; a MySQL repository maps them to snake_case columns.

## Run

```sh
npm install
copy .env.example .env
npm run dev
```

`npm run dev` and `npm start` both load variables from `.env`.

Before starting, replace the `JWT_SECRET` placeholder in `.env` with a random value of **at least 32 characters**. The server refuses to start with `JWT_SECRET must be set to at least 32 characters` otherwise.

Generate a secret with:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

On Render or another hosting provider, configure `JWT_SECRET` as an environment variable with the same 32-character minimum.

## API conventions

Protected `/v1` endpoints require:

```http
Authorization: Bearer <JWT>
```

Successful resource responses use:

```json
{
  "data": {}
}
```

Paginated responses also contain pagination metadata:

```json
{
  "page": {
    "limit": 25,
    "nextCursor": null
  }
}
```

Errors use:

```json
{
  "error": "Error message",
  "requestId": "request-id"
}
```

Validation details may also be included.

Protected endpoints can return:

- `400` — Invalid input
- `401` — Missing or invalid authentication
- `403` — Insufficient permissions
- `404` — Resource not found
- `409` — Resource conflict
- `500` — Unexpected server error

## Health

### GET `/health`

- Use case: Check basic process health.
- Authentication: None.
- Required role: None.
- Request: No path parameters, query parameters, or body.
- Response: `200` with `{ "status": "ok" }`.
- Notes: MySQL connectivity/readiness is not currently checked separately.

## Inventory / Devices

### GET `/v1/inventory`

- Use case: Return a filtered, cursor-paginated list of devices.
- Authentication: JWT required.
- Required role: `inventory:read`.
- Query parameters: `deviceType`, `status`, `centerId`, `assetTag`, `serialNumber`, `manufacturer`, `model`, `search`, `cursor`, and `limit`.
- Response: `200` with a device array and pagination metadata.
- Constraints: `deviceType` is `LAPTOP`, `TABLET`, or `HOTSPOT`; `status` is `AVAILABLE`, `CHECKED_OUT`, or `MAINTENANCE`; IDs and cursors are positive integers; `limit` is 1–100 and defaults to 25.

### POST `/v1/inventory`

- Use case: Create a device assigned to an outreach center.
- Authentication: JWT required.
- Required role: `inventory:write`.
- Request body: `assetTag`, `serialNumber`, `deviceType`, `manufacturer`, `model`, `status`, and `centerId`.
- Response: `201` with the created device.
- Errors: `404` when the center does not exist; `409` for duplicate asset tags or serial numbers.
- Constraints: `assetTag` is 1–50 characters; `serialNumber`, `manufacturer`, and `model` are 1–100 characters; enum values must match those listed above.

### GET `/v1/inventory/{deviceId}`

- Use case: Return one device by its database primary key.
- Authentication: JWT required.
- Required role: `inventory:read`.
- Path parameters: `deviceId`, a positive integer.
- Response: `200` with the device.
- Errors: `404` when the device does not exist.

### PATCH `/v1/inventory/{deviceId}`

- Use case: Update editable device identity, descriptive, or center-assignment fields.
- Authentication: JWT required.
- Required role: `inventory:write`.
- Path parameters: `deviceId`, a positive integer.
- Request body: A nonempty subset of `assetTag`, `serialNumber`, `deviceType`, `manufacturer`, `model`, and `centerId`.
- Response: `200` with the updated device.
- Errors: `404` when the device or referenced center does not exist; `409` for uniqueness conflicts.
- Notes: `status` is intentionally excluded because checkout and maintenance operations control lifecycle transitions.

### GET `/v1/inventory/{deviceId}/history`

- Use case: Return schema-backed history associated with a device.
- Authentication: JWT required.
- Required role: `inventory:read`.
- Path parameters: `deviceId`, a positive integer.
- Response: `200` with `{ "data": { "loans": [], "maintenanceRecords": [] } }`.
- Errors: `404` when the device does not exist.
- Notes: Transfers, manual changes, and edits require a future dedicated device-event table.

### GET `/v1/inventory/{deviceId}/maintenance`

- Use case: Return maintenance history for one device.
- Authentication: JWT required.
- Required role: `maintenance:read`.
- Path parameters: `deviceId`, a positive integer.
- Query parameters: `cursor` and `limit`.
- Response: `200` with a maintenance-record page.
- Errors: `404` when the device does not exist.

## Outreach Centers

### GET `/v1/centers`

- Use case: Return outreach centers.
- Authentication: JWT required.
- Required role: `centers:read`.
- Query parameters: `isActive`, `search`, `cursor`, and `limit`.
- Response: `200` with a center page.
- Constraints: `isActive` is `true` or `false`; `search` is 1–120 characters.

### POST `/v1/centers`

- Use case: Create an outreach center.
- Authentication: JWT required.
- Required role: `centers:write`.
- Request body: `centerName`, `address`, `phone`, and `isActive`.
- Response: `201` with the created center.
- Constraints: `centerName` is 1–100 characters, `address` is 1–255, `phone` is 1–20, and `isActive` is boolean.

### GET `/v1/centers/{centerId}`

- Use case: Return one outreach center.
- Authentication: JWT required.
- Required role: `centers:read`.
- Path parameters: `centerId`, a positive integer.
- Response: `200` with the center.
- Errors: `404` when the center does not exist.

### PATCH `/v1/centers/{centerId}`

- Use case: Update an outreach center.
- Authentication: JWT required.
- Required role: `centers:write`.
- Path parameters: `centerId`, a positive integer.
- Request body: A nonempty subset of `centerName`, `address`, `phone`, and `isActive`.
- Response: `200` with the updated center.
- Errors: `404` when the center does not exist.

### GET `/v1/centers/{centerId}/inventory`

- Use case: Return devices assigned to a center.
- Authentication: JWT required.
- Required role: `inventory:read`.
- Path parameters: `centerId`, a positive integer.
- Query parameters: `cursor` and `limit`.
- Response: `200` with a device page.
- Errors: `404` when the center does not exist.

### GET `/v1/centers/{centerId}/loans`

- Use case: Return loans associated with a center.
- Authentication: JWT required.
- Required role: `loans:read`.
- Path parameters: `centerId`, a positive integer.
- Query parameters: `cursor` and `limit`.
- Response: `200` with a loan page.
- Errors: `404` when the center does not exist.

## Loans

### GET `/v1/loans`

- Use case: Return filtered, paginated loans.
- Authentication: JWT required.
- Required role: `loans:read`.
- Query parameters: `loanStatus`, `centerId`, `deviceId`, `participantCode`, `reasonId`, `checkoutFrom`, `checkoutTo`, `dueFrom`, `dueTo`, `cursor`, and `limit`.
- Response: `200` with a loan page.
- Constraints: `loanStatus` is `ACTIVE`, `RETURNED`, or `OVERDUE`; range values are ISO 8601 datetimes with offsets.

### POST `/v1/loans`

- Use case: Check out an available device.
- Authentication: JWT required.
- Required role: `loans:write`.
- Request body: `deviceId`, `centerId`, `reasonId`, `participantCode`, `checkoutDate`, and `dueDate`.
- Response: `201` with an `ACTIVE` loan; the device becomes `CHECKED_OUT`.
- Errors: `404` when a referenced device, center, or reason does not exist; `409` when the device is unavailable or already has an active loan.
- Constraints: IDs are positive integers; `participantCode` is 1–50 characters; dates are ISO 8601 datetimes; `dueDate` must be after `checkoutDate`.

### GET `/v1/loans/{loanId}`

- Use case: Return one loan with its related device, center, and loan reason when available.
- Authentication: JWT required.
- Required role: `loans:read`.
- Path parameters: `loanId`, a positive integer.
- Response: `200` with the enriched loan.
- Errors: `404` when the loan does not exist.

### PATCH `/v1/loans/{loanId}`

- Use case: Update editable details on a current loan.
- Authentication: JWT required.
- Required role: `loans:write`.
- Path parameters: `loanId`, a positive integer.
- Request body: A nonempty subset of `dueDate` and `reasonId`.
- Response: `200` with the updated loan.
- Errors: `404` when the loan does not exist; `409` for a missing reason or an invalid lifecycle state.
- Notes: Loan status and return date cannot be manipulated through this endpoint.

### POST `/v1/loans/{loanId}/return`

- Use case: Return a checked-out device.
- Authentication: JWT required.
- Required role: `loans:write`.
- Path parameters: `loanId`, a positive integer.
- Request body: Optional `returnDate` as an ISO 8601 datetime; the current time is used when omitted.
- Response: `200` with the `RETURNED` loan; the device becomes `AVAILABLE`.
- Errors: `404` when the loan does not exist; `409` when it was already returned.

## Loan Reasons

### GET `/v1/loan-reasons`

- Use case: Return all valid loan reasons.
- Authentication: JWT required.
- Required role: `loan-reasons:read`.
- Request: No path parameters, query parameters, or body.
- Response: `200` with a loan-reason array.

### POST `/v1/loan-reasons`

- Use case: Create a loan reason.
- Authentication: JWT required.
- Required role: `loan-reasons:write`.
- Request body: `reasonName`.
- Response: `201` with the created reason.
- Errors: `409` when the reason name already exists.
- Constraints: `reasonName` is 1–100 characters and unique.

### GET `/v1/loan-reasons/{reasonId}`

- Use case: Return one loan reason.
- Authentication: JWT required.
- Required role: `loan-reasons:read`.
- Path parameters: `reasonId`, a positive integer.
- Response: `200` with the reason.
- Errors: `404` when the reason does not exist.

### PATCH `/v1/loan-reasons/{reasonId}`

- Use case: Rename a loan reason.
- Authentication: JWT required.
- Required role: `loan-reasons:write`.
- Path parameters: `reasonId`, a positive integer.
- Request body: `reasonName`.
- Response: `200` with the updated reason.
- Errors: `404` when the reason does not exist; `409` when the new name is already used.
- Notes: Deletion is intentionally unsupported; an `is_active` column is a future schema recommendation.

## Maintenance Records

### GET `/v1/maintenance`

- Use case: Return filtered, paginated maintenance records.
- Authentication: JWT required.
- Required role: `maintenance:read`.
- Query parameters: `deviceId`, `maintenanceStatus`, `serviceFrom`, `serviceTo`, `resolvedFrom`, `resolvedTo`, `cursor`, and `limit`.
- Response: `200` with a maintenance-record page.
- Constraints: `maintenanceStatus` is `OPEN`, `IN_PROGRESS`, or `RESOLVED`; date filters use `YYYY-MM-DD`.

### POST `/v1/maintenance`

- Use case: Open maintenance for an available device.
- Authentication: JWT required.
- Required role: `maintenance:write`.
- Request body: `deviceId`, `issueDescription`, and `serviceDate`.
- Response: `201` with an `OPEN` maintenance record; the device becomes `MAINTENANCE`.
- Errors: `404` when the device does not exist; `409` when the device is checked out or already in maintenance.
- Constraints: `deviceId` is positive, `issueDescription` is nonempty, and `serviceDate` uses `YYYY-MM-DD`.

### GET `/v1/maintenance/{maintenanceId}`

- Use case: Return one maintenance record.
- Authentication: JWT required.
- Required role: `maintenance:read`.
- Path parameters: `maintenanceId`, a positive integer.
- Response: `200` with the maintenance record.
- Errors: `404` when the record does not exist.

### PATCH `/v1/maintenance/{maintenanceId}`

- Use case: Update the issue description or advance an open record to `IN_PROGRESS`.
- Authentication: JWT required.
- Required role: `maintenance:write`.
- Path parameters: `maintenanceId`, a positive integer.
- Request body: A nonempty subset of `issueDescription` and `maintenanceStatus`; the only accepted status is `IN_PROGRESS`.
- Response: `200` with the updated maintenance record.
- Errors: `404` when the record does not exist; `409` for invalid transitions or updates to resolved records.
- Notes: Resolution uses the explicit resolve endpoint.

### POST `/v1/maintenance/{maintenanceId}/resolve`

- Use case: Resolve maintenance and return the device to inventory.
- Authentication: JWT required.
- Required role: `maintenance:write`.
- Path parameters: `maintenanceId`, a positive integer.
- Request body: Optional `resolvedDate` using `YYYY-MM-DD`; the current date is used when omitted.
- Response: `200` with the `RESOLVED` record; the device becomes `AVAILABLE`.
- Errors: `404` when the record does not exist; `409` when already resolved or another active maintenance record exists for the device.

## Authentication

**Implementation status:** The existing README documents development-token authentication. The real-user authentication endpoints below describe the planned Admin-managed authentication changes. Do not treat them as available in a deployed API until the backend implementation, tests, and deployment have been completed.

### Existing development authentication

#### POST `/v1/dev/token`

- Use case: Generate a short-lived local-development JWT without supplying role attributes.
- Authentication: None.
- Required role: None.
- Availability: Development only; the route is not registered when `NODE_ENV === "production"`.
- Request body: `tenantId`, a string from 1–120 characters.
- Response: `200` with `{ "token": string, "expiresIn": "15m" }`.
- Notes: The server assigns all development API permissions to the signed token.

Example:

```sh
curl -X POST http://127.0.0.1:3020/v1/dev/token \
  -H "content-type: application/json" \
  -d "{\"tenantId\":\"eigen-it\"}"
```

### Planned real-user authentication

The intended authentication model replaces the frontend's hardcoded demo accounts and automatic development-token login with accounts authenticated by the backend.

#### POST `/v1/auth/login`

- Use case: Authenticate an existing user.
- Authentication: None; credentials are supplied in the request.
- Request body: User email and password.
- Intended response: A signed JWT and token expiration information.
- Intended security: Passwords are stored as salted password hashes, not plaintext.
- Intended protection: Rate limiting on repeated login attempts.
- Intended token lifetime: 8 hours.

Example request:

```json
{
  "email": "admin@orlando.gov",
  "password": "your-password"
}
```

The exact response schema must match the implemented backend before the frontend is integrated.

#### GET `/v1/users`

- Use case: List users for the current tenant.
- Authentication: JWT required.
- Required permission: `users:manage`.
- Intended access: Admin only.

#### POST `/v1/auth/register`

- Use case: Create a user account through an authorized administrator.
- Authentication: JWT required.
- Required permission: `users:manage`.
- Intended access: Admin only.
- Intended account fields: Name, email, password, and role.
- Intended roles: `Admin` and `Staff`.

This is not intended to be a public self-registration endpoint.

#### PATCH `/v1/users/{userId}`

- Use case: Update an existing user account.
- Authentication: JWT required.
- Required permission: `users:manage`.
- Intended access: Admin only.
- Intended updates: Account role and active/inactive status.

### Planned roles and permissions

| Role | Intended access |
|---|---|
| Admin | Manage users and access the API functions assigned to the administrative role |
| Staff | Access operational inventory, centers, loans, loan reasons, and maintenance functions according to the final permission policy |

The exact Staff permission matrix must be reviewed before production. Do not assume that every Staff account should be allowed to create, update, or administer every resource.

### Planned initial administrator configuration

The proposed implementation uses environment variables to provision an initial administrator:

```env
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters
ADMIN_EMAIL=admin@orlando.gov
ADMIN_PASSWORD=replace-with-a-strong-password
ADMIN_NAME=System Administrator
DEMO_TENANT_ID=eigen-it
NODE_ENV=development
FRONTEND_ORIGIN=http://localhost:3000
```

Use a unique, strong administrator password. Do not commit real credentials or `.env` files to GitHub.

### Authentication implementation requirements

Before describing real-user authentication as production-ready, the following work must be completed:

1. Implement and test the login endpoint.
2. Implement Admin-only user listing, creation, and update endpoints.
3. Replace the frontend's hardcoded demo accounts with backend authentication.
4. Remove automatic frontend use of `/v1/dev/token` for normal login.
5. Store account records persistently in the database. An in-memory account map is temporary and loses accounts when the server restarts or redeploys.
6. Verify password hashing and password comparison.
7. Verify that inactive users cannot log in.
8. Verify that Staff cannot access user-management endpoints.
9. Verify that role changes and account deactivation are handled safely for existing JWT sessions.
10. Configure production CORS to allow only the intended frontend origin.
11. Confirm that the development-token endpoint is unavailable in production.
12. Run the backend tests and a production build before deployment.

## Transaction and schema TODOs

- A production MySQL repository must wrap checkout, return, maintenance opening, and maintenance resolution in transactions.
- A dedicated device-event table is required to record transfers, manual status changes, and edits independently of loans and maintenance.
- Consider adding `is_active` to `loan_reasons` if reasons need to be retired without deletion.
- Add a separate readiness endpoint or check for MySQL connectivity.
- Add persistent user and role storage before using real-user authentication in production.
- Add automated tests for login, password verification, account status, role-based authorization, and user administration.
- Review token/session invalidation when an administrator changes a user's role or deactivates an account.
