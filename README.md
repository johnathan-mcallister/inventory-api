# Community Outreach Technology Loan API

Fastify/TypeScript API for tenant-scoped outreach centers, devices, loans, loan reasons, maintenance, and user authentication. JSON fields use camelCase; a MySQL repository maps them to snake_case columns.

## Run

```bash
npm install
copy .env.example .env
npm run dev
```

## Environment Configuration

The backend uses the following environment variables:

| Variable | Description |
|---|---|
| `PORT` | API listening port |
| `HOST` | API host |
| `JWT_SECRET` | JWT signing secret, minimum 32 characters |
| `NODE_ENV` | Application environment |
| `DEMO_TENANT_ID` | Default tenant identifier |
| `ADMIN_EMAIL` | Initial administrator email |
| `ADMIN_PASSWORD` | Initial administrator password, minimum 12 characters |
| `ADMIN_NAME` | Optional administrator display name |
| `FRONTEND_ORIGIN` | Production frontend origin for CORS |

Never commit `.env` files, passwords, or production credentials to GitHub.

## API Authentication

All `/v1` endpoints require authentication except:

- `POST /v1/auth/login`
- `POST /v1/dev/token` (development only)

Authenticated requests must include:

```http
Authorization: Bearer YOUR_JWT_TOKEN
```

Successful resource responses use:

```json
{
  "data": {}
}
```

Paginated responses also contain:

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
  "error": "Error description",
  "requestId": "request-id"
}
```

Validation errors include additional details when applicable.

Protected endpoints can return:

- `400` for invalid input.
- `401` for missing or invalid authentication.
- `403` for insufficient permissions.
- `404` when a requested resource does not exist.
- `409` for conflicts.
- `429` when a rate limit is exceeded.
- `500` for unexpected server errors.

## Authentication and User Management

The API supports authenticated user accounts with role-based access control (RBAC).

Accounts have one of two roles:

- `ADMIN`
- `STAFF`

Passwords are hashed on the server using Node.js scrypt with randomly generated salts. Plaintext passwords and password hashes are never returned by the API.

### POST `/v1/auth/login`

- Use case: Authenticate an existing user.
- Authentication: None.
- Required role: None.
- Request body:

```json
{
  "email": "admin@example.org",
  "password": "YourSecurePassword"
}
```

- Response: `200` with a JWT and user information.

```json
{
  "token": "JWT_TOKEN",
  "expiresIn": 28800,
  "user": {
    "id": 1,
    "name": "System Administrator",
    "email": "admin@example.org",
    "role": "ADMIN",
    "status": "Active",
    "lastLogin": "2026-11-23T20:00:00.000Z"
  }
}
```

- Errors:
  - `400` for invalid request data.
  - `401` for invalid credentials or inactive accounts.
  - `429` when the login rate limit is exceeded.
- Constraints:
  - Email must be valid.
  - Password must contain at least one character.
  - Login requests are limited to 5 per minute.
  - Successful login tokens expire after 8 hours.

### User Roles and Permissions

#### ADMIN

Administrators receive all existing resource permissions and user-management access:

- `inventory:read`
- `inventory:write`
- `loans:read`
- `loans:write`
- `centers:read`
- `centers:write`
- `maintenance:read`
- `maintenance:write`
- `loan-reasons:read`
- `loan-reasons:write`
- `users:manage`

#### STAFF

Staff accounts receive the existing resource permissions:

- `inventory:read`
- `inventory:write`
- `loans:read`
- `loans:write`
- `centers:read`
- `centers:write`
- `maintenance:read`
- `maintenance:write`
- `loan-reasons:read`
- `loan-reasons:write`

Staff accounts do not receive `users:manage`.

### GET `/v1/users`

- Use case: Retrieve user accounts belonging to the authenticated tenant.
- Authentication: JWT required.
- Required role: `users:manage`.
- Request: No path parameters, query parameters, or body.
- Response: `200` with a user array.
- Errors:
  - `401` for missing or invalid authentication.
  - `403` for insufficient permissions.

Example response:

```json
{
  "data": [
    {
      "id": 1,
      "name": "System Administrator",
      "email": "admin@example.org",
      "role": "ADMIN",
      "status": "Active",
      "lastLogin": null
    }
  ]
}
```

Password hashes and password salts are never included in user responses.

### POST `/v1/auth/register`

- Use case: Create a new user account.
- Authentication: JWT required.
- Required role: `users:manage`.
- Request body:

```json
{
  "name": "Staff Member",
  "email": "staff@example.org",
  "password": "YourSecurePassword",
  "role": "STAFF",
  "status": "Active"
}
```

- Response: `201` with the created user.
- Errors:
  - `400` for invalid request data.
  - `401` for missing or invalid authentication.
  - `403` for insufficient permissions.
  - `409` when the email address already exists.
- Constraints:
  - Name must contain 1–100 characters.
  - Email must be valid and no longer than 160 characters.
  - Password must contain at least 12 characters.
  - Role must be `ADMIN` or `STAFF`.
  - Status must be `Active` or `Inactive`.

### PATCH `/v1/users/{userId}`

- Use case: Update a user's name, role, or account status.
- Authentication: JWT required.
- Required role: `users:manage`.
- Path parameters: `userId`, a positive integer.
- Request body: A nonempty subset of `name`, `role`, and `status`.

Example:

```json
{
  "role": "STAFF",
  "status": "Inactive"
}
```

- Response: `200` with the updated user.
- Errors:
  - `400` for invalid request data or a prohibited self-change.
  - `401` for missing or invalid authentication.
  - `403` for insufficient permissions.
  - `404` when the user does not exist.

An administrator cannot remove their own administrator role or deactivate their own account through this endpoint.

### Initial Administrator Provisioning

The initial administrator is provisioned through environment variables.

Required:

- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`

Optional:

- `ADMIN_NAME`

The initial administrator receives the `ADMIN` role and `Active` account status.

The initial administrator password must contain at least 12 characters.

Do not hardcode administrator credentials into source code or commit them to GitHub.

### Account Storage

The current proposed prototype implementation uses in-memory account storage.

Accounts created through the API are lost when the application restarts or redeploys.

Persistent database-backed account storage is required before using this implementation for permanent accounts.

### JWT Configuration

- Signing secret: `JWT_SECRET`
- Minimum secret length: 32 characters.
- Production login token expiration: 8 hours.
- Development token expiration: 15 minutes.
- Token claims include tenant ID, user ID, role, and permissions for authenticated users.
- Protected endpoints require a valid JWT.

The server validates JWT signatures before allowing access to protected endpoints.

---

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

## Development Authentication

### POST `/v1/dev/token`

- Use case: Generate a short-lived local-development JWT without supplying role attributes.
- Authentication: None.
- Required role: None.
- Availability: Development only; the route is not registered when `NODE_ENV === "production"`.
- Request body:

```json
{
  "tenantId": "eigen-it"
}
```

- Response: `200` with a token and expiration.

```json
{
  "token": "JWT_TOKEN",
  "expiresIn": "15m"
}
```

- Notes:
  - The server assigns all development API resource permissions to the signed token.
  - This endpoint does not authenticate a real user.
  - Do not use this endpoint for production authentication.

Example:

```bash
curl -X POST http://127.0.0.1:3020/v1/dev/token \
  -H "content-type: application/json" \
  -d "{\"tenantId\":\"eigen-it\"}"
```

## Transaction and Schema TODOs

- A production MySQL repository must wrap checkout, return, maintenance opening, and maintenance resolution in transactions.
- A dedicated device-event table is required to record transfers, manual status changes, and edits independently of loans and maintenance.
- Consider adding `is_active` to `loan_reasons` if reasons need to be retired without deletion.
- Add a separate readiness endpoint or check for MySQL connectivity.
- Replace in-memory account storage with persistent database-backed user accounts before relying on permanent authentication.
- Add automated tests for successful login, invalid credentials, inactive accounts, role authorization, account creation, and account updates.
- Review the Staff permission matrix before production deployment.
- Configure production CORS to allow only the approved frontend origin.
- Consider account lockout, password reset, and account recovery workflows as additional security requirements.
