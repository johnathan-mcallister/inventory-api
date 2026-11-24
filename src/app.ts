import Fastify, {
  type FastifyInstance,
  type FastifyRequest
} from "fastify";

import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";

import {
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";

import { InMemoryInventoryRepository } from "./repository.js";

import {
  DEVICE_STATUSES,
  DEVICE_TYPES,
  LOAN_STATUSES,
  MAINTENANCE_STATUSES,
  type Account,
  type InventoryRepository
} from "./types.js";

// --------------------------------------------------
// JWT TYPES
// --------------------------------------------------

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      tenantId: string;
      roles: string[];
      userId?: number;
      role?: "ADMIN" | "STAFF";
    };

    user: {
      tenantId: string;
      roles: string[];
      userId?: number;
      role?: "ADMIN" | "STAFF";
    };
  }
}

// --------------------------------------------------
// VALIDATION SCHEMAS
// --------------------------------------------------

const positiveId = z.coerce.number().int().positive();

const deviceType = z.enum(DEVICE_TYPES);
const deviceStatus = z.enum(DEVICE_STATUSES);
const loanStatus = z.enum(LOAN_STATUSES);
const maintenanceStatus = z.enum(MAINTENANCE_STATUSES);

const date = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine(
    (v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)),
    "Invalid date"
  );

const dateTime = z.string().datetime({ offset: true });

const pagination = {
  cursor: positiveId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25)
};

const nonempty = (max: number) =>
  z.string().trim().min(1).max(max);

const idParams = (name: string) =>
  z.object({ [name]: positiveId });

const deviceBody = z.object({
  assetTag: nonempty(50),
  serialNumber: nonempty(100),
  deviceType,
  manufacturer: nonempty(100),
  model: nonempty(100),
  status: deviceStatus,
  centerId: positiveId
}).strict();

const centerBody = z.object({
  centerName: nonempty(100),
  address: nonempty(255),
  phone: nonempty(20),
  isActive: z.boolean()
}).strict();

const loanBody = z.object({
  deviceId: positiveId,
  centerId: positiveId,
  reasonId: positiveId,
  participantCode: nonempty(50),
  checkoutDate: dateTime,
  dueDate: dateTime
}).strict().refine(
  (x) => x.dueDate > x.checkoutDate,
  {
    message: "dueDate must be after checkoutDate",
    path: ["dueDate"]
  }
);

const maintenanceBody = z.object({
  deviceId: positiveId,
  issueDescription: nonempty(65535),
  serviceDate: date
}).strict();

// --------------------------------------------------
// PERMISSIONS
// --------------------------------------------------

const resourceRoles = [
  "inventory:read",
  "inventory:write",
  "loans:read",
  "loans:write",
  "centers:read",
  "centers:write",
  "maintenance:read",
  "maintenance:write",
  "loan-reasons:read",
  "loan-reasons:write"
];

const adminRoles = [
  ...resourceRoles,
  "users:manage"
];

// --------------------------------------------------
// USER ACCOUNT AND PASSWORD SECURITY
// --------------------------------------------------

const passwordSchema = z.string()
  .min(12, "Password must contain at least 12 characters")
  .max(200);

function hashPassword(
  password: string,
  salt: string
): string {
  return scryptSync(password, salt, 64).toString("hex");
}

function safeAccount(account: Account) {
  return {
    id: account.id,
    name: account.name,
    email: account.email,
    role: account.role,
    status: account.status,
    lastLogin: account.lastLogin
  };
}

// --------------------------------------------------
// GENERAL HELPERS
// --------------------------------------------------

function parse<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown
): z.output<S> {
  const result = schema.safeParse(value);

  if (!result.success) {
    throw Object.assign(
      new Error("Invalid request"),
      {
        statusCode: 400,
        issues: result.error.flatten()
      }
    );
  }

  return result.data;
}

function requireRole(
  request: FastifyRequest,
  role: string
) {
  if (!request.user.roles.includes(role)) {
    throw Object.assign(
      new Error("Insufficient permissions"),
      { statusCode: 403 }
    );
  }
}

const authorize = (role: string) =>
  async (request: FastifyRequest) =>
    requireRole(request, role);

const pageResponse = <T>(
  result: {
    items: T[];
    nextCursor?: number;
  },
  limit: number
) => ({
  data: result.items,
  page: {
    limit,
    nextCursor: result.nextCursor ?? null
  }
});

// --------------------------------------------------
// APPLICATION
// --------------------------------------------------

export async function buildApp(
  repository: InventoryRepository =
    new InMemoryInventoryRepository()
): Promise<FastifyInstance> {

  const app = Fastify({
    logger: {
      redact: [
        "req.headers.authorization",
        "req.body.password",
        "reply.headers.set-cookie"
      ]
    }
  });

  // ------------------------------------------------
  // ENVIRONMENT CONFIGURATION
  // ------------------------------------------------

  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set to at least 32 characters"
    );
  }

  const tenantId =
    process.env.DEMO_TENANT_ID ?? "eigen-it";

  // ------------------------------------------------
  // PLUGINS
  // ------------------------------------------------

  await app.register(helmet, {
    contentSecurityPolicy: false
  });

  // PATCH is required by the existing update endpoints.
  // Restrict the origin to the frontend domain in production.
  const allowedOrigin = process.env.FRONTEND_ORIGIN;

  await app.register(cors, {
    origin:
      process.env.NODE_ENV === "production" && allowedOrigin
        ? allowedOrigin
        : "*",
    methods: [
      "GET",
      "HEAD",
      "POST",
      "PATCH",
      "OPTIONS"
    ]
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute"
  });

  await app.register(jwt, {
    secret
  });

  // ------------------------------------------------
  // ERROR HANDLER
  // ------------------------------------------------

  app.setErrorHandler((error, request, reply) => {
    request.log.warn(
      {
        err: error,
        requestId: request.id
      },
      "Request failed"
    );

    const known = error as Error & {
      statusCode?: number;
      issues?: unknown;
    };

    const statusCode =
      known.statusCode && known.statusCode >= 400
        ? known.statusCode
        : 500;

    reply.code(statusCode).send({
      error:
        statusCode === 500
          ? "Internal server error"
          : known.message,
      requestId: request.id,
      ...(known.issues
        ? { details: known.issues }
        : {})
    });
  });

  // ------------------------------------------------
  // HEALTH CHECK
  // ------------------------------------------------

  app.get("/health", async () => ({
    status: "ok"
  }));

  // ------------------------------------------------
  // USER ACCOUNT STORAGE
  // ------------------------------------------------

  // Accounts are stored in the shared
  // InMemoryInventoryRepository.
  // No SQL database is used.

  // ------------------------------------------------
  // INITIAL ADMINISTRATOR
  // ------------------------------------------------

  const adminEmail = process.env.ADMIN_EMAIL
    ?.trim()
    .toLowerCase();

  const adminPassword = process.env.ADMIN_PASSWORD;

  if (adminEmail && adminPassword) {

    if (adminPassword.length < 12) {
      throw new Error(
        "ADMIN_PASSWORD must be at least 12 characters"
      );
    }

    // Prevent duplicate administrator creation
    // when the repository is reused.

    const existingAdmin =
      await repository.findAccountByEmail(
        tenantId,
        adminEmail
      );

    if (!existingAdmin) {
      const salt = randomBytes(16).toString("hex");

      await repository.createAccount(
        tenantId,
        {
          name:
            process.env.ADMIN_NAME?.trim() ||
            "System Administrator",
          email: adminEmail,
          role: "ADMIN",
          status: "Active",
          passwordSalt: salt,
          passwordHash: hashPassword(
            adminPassword,
            salt
          )
        }
      );
    }
  }

  // ------------------------------------------------
  // AUTHENTICATION HOOK
  // ------------------------------------------------

   await request.jwtVerify();

    if (request.user.userId !== undefined) {
      const account = await repository.getAccount(
        request.user.tenantId,
        request.user.userId
      );

      if (!account || account.status !== "Active") {
        throw Object.assign(
          new Error("Account is inactive or unavailable"),
          { statusCode: 401 }
        );
      }
    }
  });

  // ------------------------------------------------
  // LOGIN
  // ------------------------------------------------

  app.post(
    "/v1/auth/login",
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: "1 minute"
        }
      }
    },
    async (request, reply) => {

      const body = parse(
        z.object({
          email: z.string().email().max(160),
          password: z.string().min(1).max(200)
        }).strict(),
        request.body
      );

      const email = body.email
        .trim()
        .toLowerCase();

      const account =
        await repository.findAccountByEmail(
          tenantId,
          email
        );

      if (
        !account ||
        account.status !== "Active"
      ) {
        return reply.code(401).send({
          error: "Invalid email or password",
          requestId: request.id
        });
      }

      const actual = Buffer.from(
        hashPassword(
          body.password,
          account.passwordSalt
        ),
        "hex"
      );

      const expected = Buffer.from(
        account.passwordHash,
        "hex"
      );

      if (
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      ) {
        return reply.code(401).send({
          error: "Invalid email or password",
          requestId: request.id
        });
      }

      const updatedAccount =
        await repository.updateAccount(
          tenantId,
          account.id,
          {
            lastLogin: new Date().toISOString()
          }
        );

      if (!updatedAccount) {
        return reply.code(401).send({
          error: "Invalid email or password",
          requestId: request.id
        });
      }

      const roles =
        account.role === "ADMIN"
          ? adminRoles
          : resourceRoles;

      const token = await reply.jwtSign(
        {
          tenantId,
          roles,
          userId: account.id,
          role: account.role
        },
        {
          expiresIn: "8h"
        }
      );

      return {
        token,
        expiresIn: 28800,
        user: safeAccount(updatedAccount)
      };
    }
  );
   // --------------------------------------------------
  // USER MANAGEMENT: LIST USERS
  // ADMIN ONLY
  // --------------------------------------------------

  app.get(
    "/v1/users",
    {
      preHandler: authorize("users:manage")
    },
    async (request) => {

      const accounts = await repository.listAccounts(
        request.user.tenantId
      );

      return {
        data: accounts.map(safeAccount)
      };
    }
  );
  // --------------------------------------------------
  // USER MANAGEMENT: CREATE USER
  // ADMIN ONLY
  // --------------------------------------------------

  app.post(
    "/v1/auth/register",
    {
      preHandler: authorize("users:manage")
    },
    async (request, reply) => {

      const body = parse(
        z.object({
          name: nonempty(100),
          email: z.string().email().max(160),
          password: passwordSchema,
          role: z.enum(["ADMIN", "STAFF"]),
          status: z.enum([
            "Active",
            "Inactive"
          ]).default("Active")
        }).strict(),
        request.body
      );

      const email = body.email
        .trim()
        .toLowerCase();

      const salt = randomBytes(16).toString("hex");

      const account = await repository.createAccount(
        request.user.tenantId,
        {
          name: body.name.trim(),
          email,
          role: body.role,
          status: body.status,
          passwordSalt: salt,
          passwordHash: hashPassword(
            body.password,
            salt
          )
        }
      );

      return reply.code(201).send({
        data: safeAccount(account)
      });
    }
  );
   // --------------------------------------------------
  // USER MANAGEMENT: UPDATE USER
  // ADMIN ONLY
  // --------------------------------------------------

  app.patch(
    "/v1/users/:userId",
    {
      preHandler: authorize("users:manage")
    },
    async (request, reply) => {

      const { userId } = parse(
        idParams("userId"),
        request.params
      ) as {
        userId: number;
      };

      const body = parse(
        z.object({
          name: nonempty(100).optional(),
          role: z.enum([
            "ADMIN",
            "STAFF"
          ]).optional(),
          status: z.enum([
            "Active",
            "Inactive"
          ]).optional()
        }).strict().refine(
          (value) =>
            Object.keys(value).length > 0,
          "At least one field is required"
        ),
        request.body
      );

      const account = await repository.getAccount(
        request.user.tenantId,
        userId
      );

      if (!account) {
        return reply.code(404).send({
          error: "User not found",
          requestId: request.id
        });
      }

      // Prevent administrators from removing
      // their own administrator access.

      if (
        request.user.userId === userId &&
        (
          body.role === "STAFF" ||
          body.status === "Inactive"
        )
      ) {
        return reply.code(400).send({
          error:
            "You cannot remove your own administrator access or deactivate your own account",
          requestId: request.id
        });
      }

      const updatedAccount =
        await repository.updateAccount(
          request.user.tenantId,
          userId,
          body
        );

      if (!updatedAccount) {
        return reply.code(404).send({
          error: "User not found",
          requestId: request.id
        });
      }

      return {
        data: safeAccount(updatedAccount)
      };
    }
  );
  // ------------------------------------------------
  // INVENTORY
  // ------------------------------------------------

  const deviceQuery = z.object({
    deviceType: deviceType.optional(),
    status: deviceStatus.optional(),
    centerId: positiveId.optional(),
    assetTag: nonempty(50).optional(),
    serialNumber: nonempty(100).optional(),
    manufacturer: nonempty(100).optional(),
    model: nonempty(100).optional(),
    search: nonempty(120).optional(),
    ...pagination
  }).strict();

  // List inventory
  app.get(
    "/v1/inventory",
    {
      preHandler: authorize("inventory:read")
    },
    async (request) => {

      const q = parse(
        deviceQuery,
        request.query
      );

      return pageResponse(
        await repository.listDevices(
          request.user.tenantId,
          q
        ),
        q.limit
      );
    }
  );

  // Create inventory
  app.post(
    "/v1/inventory",
    {
      preHandler: authorize("inventory:write")
    },
    async (request, reply) => {

      const body = parse(
        deviceBody,
        request.body
      );

      return reply.code(201).send({
        data: await repository.createDevice(
          request.user.tenantId,
          body
        )
      });
    }
  );

  // Get inventory item
  app.get(
    "/v1/inventory/:deviceId",
    {
      preHandler: authorize("inventory:read")
    },
    async (request, reply) => {

      const { deviceId } = parse(
        idParams("deviceId"),
        request.params
      ) as {
        deviceId: number;
      };

      const data = await repository.getDevice(
        request.user.tenantId,
        deviceId
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Device not found",
            requestId: request.id
          });
    }
  );

  // Update inventory item
  app.patch(
    "/v1/inventory/:deviceId",
    {
      preHandler: authorize("inventory:write")
    },
    async (request, reply) => {

      const { deviceId } = parse(
        idParams("deviceId"),
        request.params
      ) as {
        deviceId: number;
      };

      const body = parse(
        deviceBody
          .omit({ status: true })
          .partial()
          .refine(
            (x) => Object.keys(x).length > 0,
            "At least one field is required"
          ),
        request.body
      );

      /*
       * Lifecycle status is intentionally not
       * client-editable through this endpoint.
       */

      const data = await repository.updateDevice(
        request.user.tenantId,
        deviceId,
        body
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Device not found",
            requestId: request.id
          });
    }
  );

  // Device history
  app.get(
    "/v1/inventory/:deviceId/history",
    {
      preHandler: authorize("inventory:read")
    },
    async (request, reply) => {

      const { deviceId } = parse(
        idParams("deviceId"),
        request.params
      ) as {
        deviceId: number;
      };

      if (
        !await repository.getDevice(
          request.user.tenantId,
          deviceId
        )
      ) {
        return reply.code(404).send({
          error: "Device not found",
          requestId: request.id
        });
      }

      const [loans, maintenance] =
        await Promise.all([
          repository.listLoans(
            request.user.tenantId,
            {
              deviceId,
              limit: 100
            }
          ),

          repository.listMaintenance(
            request.user.tenantId,
            {
              deviceId,
              limit: 100
            }
          )
        ]);

      return {
        data: {
          loans: loans.items,
          maintenanceRecords: maintenance.items
        }
      };
    }
  );

  // Device maintenance
  app.get(
    "/v1/inventory/:deviceId/maintenance",
    {
      preHandler: authorize("maintenance:read")
    },
    async (request, reply) => {

      const { deviceId } = parse(
        idParams("deviceId"),
        request.params
      ) as {
        deviceId: number;
      };

      if (
        !await repository.getDevice(
          request.user.tenantId,
          deviceId
        )
      ) {
        return reply.code(404).send({
          error: "Device not found",
          requestId: request.id
        });
      }

      const q = parse(
        z.object(pagination).strict(),
        request.query
      );

      return pageResponse(
        await repository.listMaintenance(
          request.user.tenantId,
          {
            ...q,
            deviceId
          }
        ),
        q.limit
      );
    }
  );

  // ------------------------------------------------
  // OUTREACH CENTERS
  // ------------------------------------------------

  const centerQuery = z.object({
    isActive: z.enum([
      "true",
      "false"
    ]).transform(
      (x) => x === "true"
    ).optional(),
    search: nonempty(120).optional(),
    ...pagination
  }).strict();

  // List centers
  app.get(
    "/v1/centers",
    {
      preHandler: authorize("centers:read")
    },
    async (request) => {

      const q = parse(
        centerQuery,
        request.query
      );

      return pageResponse(
        await repository.listCenters(
          request.user.tenantId,
          q
        ),
        q.limit
      );
    }
  );

  // Create center
  app.post(
    "/v1/centers",
    {
      preHandler: authorize("centers:write")
    },
    async (request, reply) => {

      return reply.code(201).send({
        data: await repository.createCenter(
          request.user.tenantId,
          parse(centerBody, request.body)
        )
      });
    }
  );

  // Get center
  app.get(
    "/v1/centers/:centerId",
    {
      preHandler: authorize("centers:read")
    },
    async (request, reply) => {

      const { centerId } = parse(
        idParams("centerId"),
        request.params
      ) as {
        centerId: number;
      };

      const data = await repository.getCenter(
        request.user.tenantId,
        centerId
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Center not found",
            requestId: request.id
          });
    }
  );

  // Update center
  app.patch(
    "/v1/centers/:centerId",
    {
      preHandler: authorize("centers:write")
    },
    async (request, reply) => {

      const { centerId } = parse(
        idParams("centerId"),
        request.params
      ) as {
        centerId: number;
      };

      const body = parse(
        centerBody.partial().refine(
          (x) => Object.keys(x).length > 0,
          "At least one field is required"
        ),
        request.body
      );

      const data = await repository.updateCenter(
        request.user.tenantId,
        centerId,
        body
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Center not found",
            requestId: request.id
          });
    }
  );

  // Center inventory
  app.get(
    "/v1/centers/:centerId/inventory",
    {
      preHandler: authorize("inventory:read")
    },
    async (request, reply) => {

      const { centerId } = parse(
        idParams("centerId"),
        request.params
      ) as {
        centerId: number;
      };

      if (
        !await repository.getCenter(
          request.user.tenantId,
          centerId
        )
      ) {
        return reply.code(404).send({
          error: "Center not found",
          requestId: request.id
        });
      }

      const q = parse(
        z.object(pagination).strict(),
        request.query
      );

      return pageResponse(
        await repository.listDevices(
          request.user.tenantId,
          {
            ...q,
            centerId
          }
        ),
        q.limit
      );
    }
  );

  // Center loans
  app.get(
    "/v1/centers/:centerId/loans",
    {
      preHandler: authorize("loans:read")
    },
    async (request, reply) => {

      const { centerId } = parse(
        idParams("centerId"),
        request.params
      ) as {
        centerId: number;
      };

      if (
        !await repository.getCenter(
          request.user.tenantId,
          centerId
        )
      ) {
        return reply.code(404).send({
          error: "Center not found",
          requestId: request.id
        });
      }

      const q = parse(
        z.object(pagination).strict(),
        request.query
      );

      return pageResponse(
        await repository.listLoans(
          request.user.tenantId,
          {
            ...q,
            centerId
          }
        ),
        q.limit
      );
    }
  );

  // ------------------------------------------------
  // LOANS
  // ------------------------------------------------

  const loanQuery = z.object({
    loanStatus: loanStatus.optional(),
    centerId: positiveId.optional(),
    deviceId: positiveId.optional(),
    participantCode: nonempty(50).optional(),
    reasonId: positiveId.optional(),
    checkoutFrom: dateTime.optional(),
    checkoutTo: dateTime.optional(),
    dueFrom: dateTime.optional(),
    dueTo: dateTime.optional(),
    ...pagination
  }).strict();

  // List loans
  app.get(
    "/v1/loans",
    {
      preHandler: authorize("loans:read")
    },
    async (request) => {

      const q = parse(
        loanQuery,
        request.query
      );

      return pageResponse(
        await repository.listLoans(
          request.user.tenantId,
          q
        ),
        q.limit
      );
    }
  );

  // Create loan
  app.post(
    "/v1/loans",
    {
      preHandler: authorize("loans:write")
    },
    async (request, reply) => {

      return reply.code(201).send({
        data: await repository.createLoan(
          request.user.tenantId,
          parse(loanBody, request.body)
        )
      });
    }
  );

  // Get loan
  app.get(
    "/v1/loans/:loanId",
    {
      preHandler: authorize("loans:read")
    },
    async (request, reply) => {

      const { loanId } = parse(
        idParams("loanId"),
        request.params
      ) as {
        loanId: number;
      };

      const loan = await repository.getLoan(
        request.user.tenantId,
        loanId
      );

      if (!loan) {
        return reply.code(404).send({
          error: "Loan not found",
          requestId: request.id
        });
      }

      const [device, center, reason] =
        await Promise.all([
          repository.getDevice(
            request.user.tenantId,
            loan.deviceId
          ),

          repository.getCenter(
            request.user.tenantId,
            loan.centerId
          ),

          repository.getLoanReason(
            request.user.tenantId,
            loan.reasonId
          )
        ]);

      return {
        data: {
          ...loan,
          device,
          center,
          reason
        }
      };
    }
  );

  // Update loan
  app.patch(
    "/v1/loans/:loanId",
    {
      preHandler: authorize("loans:write")
    },
    async (request, reply) => {

      const { loanId } = parse(
        idParams("loanId"),
        request.params
      ) as {
        loanId: number;
      };

      const body = parse(
        z.object({
          dueDate: dateTime.optional(),
          reasonId: positiveId.optional()
        }).strict().refine(
          (x) => Object.keys(x).length > 0,
          "At least one field is required"
        ),
        request.body
      );

      const data = await repository.updateLoan(
        request.user.tenantId,
        loanId,
        body
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Loan not found",
            requestId: request.id
          });
    }
  );

  // Return loan
  app.post(
    "/v1/loans/:loanId/return",
    {
      preHandler: authorize("loans:write")
    },
    async (request, reply) => {

      const { loanId } = parse(
        idParams("loanId"),
        request.params
      ) as {
        loanId: number;
      };

      const { returnDate } = parse(
        z.object({
          returnDate: dateTime.default(
            () => new Date().toISOString()
          )
        }).strict(),
        request.body ?? {}
      );

      const data = await repository.returnLoan(
        request.user.tenantId,
        loanId,
        returnDate
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Loan not found",
            requestId: request.id
          });
    }
  );

  // ------------------------------------------------
  // LOAN REASONS
  // ------------------------------------------------

  // List loan reasons
  app.get(
    "/v1/loan-reasons",
    {
      preHandler: authorize("loan-reasons:read")
    },
    async (request) => ({
      data: await repository.listLoanReasons(
        request.user.tenantId
      )
    })
  );

  // Create loan reason
  app.post(
    "/v1/loan-reasons",
    {
      preHandler: authorize("loan-reasons:write")
    },
    async (request, reply) => {

      const { reasonName } = parse(
        z.object({
          reasonName: nonempty(100)
        }).strict(),
        request.body
      );

      return reply.code(201).send({
        data: await repository.createLoanReason(
          request.user.tenantId,
          reasonName
        )
      });
    }
  );

  // Get loan reason
  app.get(
    "/v1/loan-reasons/:reasonId",
    {
      preHandler: authorize("loan-reasons:read")
    },
    async (request, reply) => {

      const { reasonId } = parse(
        idParams("reasonId"),
        request.params
      ) as {
        reasonId: number;
      };

      const data = await repository.getLoanReason(
        request.user.tenantId,
        reasonId
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Loan reason not found",
            requestId: request.id
          });
    }
  );

  // Update loan reason
  app.patch(
    "/v1/loan-reasons/:reasonId",
    {
      preHandler: authorize("loan-reasons:write")
    },
    async (request, reply) => {

      const { reasonId } = parse(
        idParams("reasonId"),
        request.params
      ) as {
        reasonId: number;
      };

      const { reasonName } = parse(
        z.object({
          reasonName: nonempty(100)
        }).strict(),
        request.body
      );

      const data = await repository.updateLoanReason(
        request.user.tenantId,
        reasonId,
        reasonName
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Loan reason not found",
            requestId: request.id
          });
    }
  );

  // ------------------------------------------------
  // MAINTENANCE
  // ------------------------------------------------

  const maintenanceQuery = z.object({
    deviceId: positiveId.optional(),
    maintenanceStatus: maintenanceStatus.optional(),
    serviceFrom: date.optional(),
    serviceTo: date.optional(),
    resolvedFrom: date.optional(),
    resolvedTo: date.optional(),
    ...pagination
  }).strict();

  // List maintenance records
  app.get(
    "/v1/maintenance",
    {
      preHandler: authorize("maintenance:read")
    },
    async (request) => {

      const q = parse(
        maintenanceQuery,
        request.query
      );

      return pageResponse(
        await repository.listMaintenance(
          request.user.tenantId,
          q
        ),
        q.limit
      );
    }
  );

  // Create maintenance record
  app.post(
    "/v1/maintenance",
    {
      preHandler: authorize("maintenance:write")
    },
    async (request, reply) => {

      return reply.code(201).send({
        data: await repository.createMaintenance(
          request.user.tenantId,
          parse(maintenanceBody, request.body)
        )
      });
    }
  );

  // Get maintenance record
  app.get(
    "/v1/maintenance/:maintenanceId",
    {
      preHandler: authorize("maintenance:read")
    },
    async (request, reply) => {

      const { maintenanceId } = parse(
        idParams("maintenanceId"),
        request.params
      ) as {
        maintenanceId: number;
      };

      const data = await repository.getMaintenance(
        request.user.tenantId,
        maintenanceId
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Maintenance record not found",
            requestId: request.id
          });
    }
  );

  // Update maintenance record
  app.patch(
    "/v1/maintenance/:maintenanceId",
    {
      preHandler: authorize("maintenance:write")
    },
    async (request, reply) => {

      const { maintenanceId } = parse(
        idParams("maintenanceId"),
        request.params
      ) as {
        maintenanceId: number;
      };

      const body = parse(
        z.object({
          issueDescription: nonempty(65535).optional(),
          maintenanceStatus: z.literal(
            "IN_PROGRESS"
          ).optional()
        }).strict().refine(
          (x) => Object.keys(x).length > 0,
          "At least one field is required"
        ),
        request.body
      );

      const data = await repository.updateMaintenance(
        request.user.tenantId,
        maintenanceId,
        body
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Maintenance record not found",
            requestId: request.id
          });
    }
  );

  // Resolve maintenance record
  app.post(
    "/v1/maintenance/:maintenanceId/resolve",
    {
      preHandler: authorize("maintenance:write")
    },
    async (request, reply) => {

      const { maintenanceId } = parse(
        idParams("maintenanceId"),
        request.params
      ) as {
        maintenanceId: number;
      };

      const { resolvedDate } = parse(
        z.object({
          resolvedDate: date.default(
            () => new Date().toISOString().slice(0, 10)
          )
        }).strict(),
        request.body ?? {}
      );

      const data = await repository.resolveMaintenance(
        request.user.tenantId,
        maintenanceId,
        resolvedDate
      );

      return data
        ? { data }
        : reply.code(404).send({
            error: "Maintenance record not found",
            requestId: request.id
          });
    }
  );

  // ------------------------------------------------
  // DEVELOPMENT TOKEN
  // DISABLED IN PRODUCTION
  // ------------------------------------------------

  if (process.env.NODE_ENV !== "production") {

    app.post(
      "/v1/dev/token",
      async (request, reply) => {

        const body = parse(
          z.object({
            tenantId: nonempty(120)
          }).strict(),
          request.body
        );

        const token = await reply.jwtSign(
          {
            tenantId: body.tenantId,
            roles: resourceRoles
          },
          {
            expiresIn: "15m"
          }
        );

        return {
          token,
          expiresIn: "15m"
        };
      }
    );
  }

  // ------------------------------------------------
  // RETURN APPLICATION
  // ------------------------------------------------

  return app;
}
