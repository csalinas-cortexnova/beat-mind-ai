---
name: polar
description: "Help with Polar payment integration in Next.js projects. Use when implementing checkout flows, subscriptions, webhooks, license keys, or debugging payment issues. Covers Polar SDK usage, webhook verification, and subscription management. Polar is a Merchant of Record that handles international tax compliance."
allowed-tools: Read, Glob, Grep, Write, Edit, Bash, WebSearch
---

# Polar Integration Helper

Assist with Polar payment platform integration for SaaS applications. Polar is a Merchant of Record that handles international tax compliance (VAT, GST, sales tax).

## Quick Reference

### Installation
```bash
bun add @polar-sh/sdk
```

### Environment Variables
```bash
# Server-side (secret)
POLAR_ACCESS_TOKEN="polar_at_..."
POLAR_WEBHOOK_SECRET="polar_whs_..."

# Organization and Product IDs
POLAR_ORG_ID="your-org-id"
POLAR_PRODUCT_ID="your-product-id"

# Environment (sandbox or production)
POLAR_MODE="sandbox"

# App URL for callbacks
NEXT_PUBLIC_APP_URL="https://your-app.com"
```

### SDK Initialization

```typescript
// lib/polar.ts
import { Polar } from "@polar-sh/sdk";

export const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: process.env.POLAR_MODE === "production" ? "production" : "sandbox",
});

export const POLAR_ORG_ID = process.env.POLAR_ORG_ID!;
export const POLAR_PRODUCT_ID = process.env.POLAR_PRODUCT_ID!;

// Constants for your app
export const PRO_CREDITS_PER_MONTH = 50;
```

## Common Tasks

### 1. Create Checkout Session

```typescript
// app/api/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { polar, POLAR_PRODUCT_ID } from "@/lib/polar";

export async function POST(request: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checkout = await polar.checkouts.create({
    productId: POLAR_PRODUCT_ID,
    successUrl: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success?checkout_id={CHECKOUT_ID}`,
    customerEmail: user.email, // Optional: pre-fill email
    metadata: { userId },
  });

  return NextResponse.json({ url: checkout.url });
}
```

### 2. Create Checkout Link (No-Code)

```typescript
// Alternative: use pre-generated checkout links
const checkoutLink = await polar.checkoutLinks.create({
  productId: POLAR_PRODUCT_ID,
});

// Use checkoutLink.url directly
```

### 3. Webhook Handler

```typescript
// app/api/webhooks/polar/route.ts
import { NextRequest, NextResponse } from "next/server";
import {
  validateEvent,
  WebhookVerificationError,
} from "@polar-sh/sdk/webhooks";
import { db } from "@/lib/db";
import { users, creditTransactions } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { PRO_CREDITS_PER_MONTH } from "@/lib/polar";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers.entries());

  let event;

  try {
    event = validateEvent(
      body,
      headers,
      process.env.POLAR_WEBHOOK_SECRET!
    );
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      console.error("Webhook signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    throw error;
  }

  switch (event.type) {
    case "subscription.created": {
      const subscription = event.data;
      const userId = subscription.metadata?.userId as string;
      if (userId) {
        await db
          .update(users)
          .set({
            plan: "pro",
            subscriptionStatus: "pending",
            polarSubscriptionId: subscription.id,
          })
          .where(eq(users.id, userId));
      }
      break;
    }

    case "subscription.active": {
      const subscription = event.data;
      const userId = subscription.metadata?.userId as string;
      if (userId) {
        // Check for duplicate grants
        const existingGrant = await db.query.creditTransactions.findFirst({
          where: eq(
            creditTransactions.referenceId,
            `polar_sub_${subscription.id}_initial`
          ),
        });

        if (!existingGrant) {
          await db.transaction(async (tx) => {
            await tx
              .update(users)
              .set({
                plan: "pro",
                subscriptionStatus: "active",
                creditsBalance: sql`${users.creditsBalance} + ${PRO_CREDITS_PER_MONTH}`,
              })
              .where(eq(users.id, userId));

            await tx.insert(creditTransactions).values({
              userId,
              amount: PRO_CREDITS_PER_MONTH,
              type: "subscription_grant",
              referenceId: `polar_sub_${subscription.id}_initial`,
            });
          });
        }
      }
      break;
    }

    case "subscription.updated": {
      const subscription = event.data;
      const userId = subscription.metadata?.userId as string;
      if (userId && subscription.currentPeriodStart) {
        // Grant credits on renewal (use period as deduplication key)
        const periodKey = new Date(subscription.currentPeriodStart)
          .toISOString()
          .slice(0, 10);
        const referenceId = `polar_sub_${subscription.id}_${periodKey}`;

        const existingGrant = await db.query.creditTransactions.findFirst({
          where: eq(creditTransactions.referenceId, referenceId),
        });

        if (!existingGrant) {
          await db.transaction(async (tx) => {
            await tx
              .update(users)
              .set({
                creditsBalance: sql`${users.creditsBalance} + ${PRO_CREDITS_PER_MONTH}`,
              })
              .where(eq(users.id, userId));

            await tx.insert(creditTransactions).values({
              userId,
              amount: PRO_CREDITS_PER_MONTH,
              type: "subscription_renewal",
              referenceId,
            });
          });
        }
      }
      break;
    }

    case "subscription.canceled":
    case "subscription.revoked": {
      const subscription = event.data;
      const userId = subscription.metadata?.userId as string;
      if (userId) {
        await db
          .update(users)
          .set({
            plan: "free",
            subscriptionStatus: "canceled",
          })
          .where(eq(users.id, userId));
      }
      break;
    }

    case "order.paid": {
      const order = event.data;
      // Handle one-time purchases
      console.log("Order paid:", order.id);
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

## Webhook Events

| Event | When to Handle |
|-------|----------------|
| `checkout.created` | Checkout session started |
| `checkout.updated` | Checkout status changed |
| `subscription.created` | New subscription initialized |
| `subscription.active` | Subscription becomes active |
| `subscription.updated` | Plan change, renewal |
| `subscription.canceled` | User cancels subscription |
| `subscription.revoked` | Subscription revoked by admin |
| `subscription.uncanceled` | User reactivates subscription |
| `order.created` | New order created |
| `order.paid` | Payment successful |
| `order.refunded` | Order refunded |
| `benefit_grant.created` | Benefit granted to customer |
| `benefit_grant.revoked` | Benefit revoked |
| `customer.created` | New customer created |
| `customer.updated` | Customer info changed |

## Subscription Status Values

| Status | Description |
|--------|-------------|
| `active` | Subscription is current |
| `canceled` | User canceled, ends at period end |
| `revoked` | Immediately terminated |
| `incomplete` | Payment pending |

## Database Schema

### Users Table (add Polar fields)
```sql
polarCustomerId      TEXT UNIQUE
polarSubscriptionId  TEXT
plan                 TEXT DEFAULT 'free'
subscriptionStatus   TEXT
creditsBalance       INTEGER DEFAULT 0
```

### Credit Transactions Table (for idempotency)
```sql
id            TEXT PRIMARY KEY
userId        TEXT NOT NULL
amount        INTEGER NOT NULL
type          TEXT NOT NULL
referenceId   TEXT UNIQUE  -- Prevents duplicate grants
createdAt     TIMESTAMP DEFAULT NOW()
```

## Feature Gating

```typescript
async function checkProAccess(userId: string): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  return user?.plan === "pro" && user?.subscriptionStatus === "active";
}

async function checkCredits(userId: string, required: number): Promise<boolean> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  return (user?.creditsBalance ?? 0) >= required;
}

async function deductCredits(userId: string, amount: number): Promise<void> {
  await db
    .update(users)
    .set({
      creditsBalance: sql`${users.creditsBalance} - ${amount}`,
    })
    .where(eq(users.id, userId));
}
```

## Testing

### Sandbox Environment

Polar provides a sandbox environment for testing:

```typescript
// Use sandbox mode in development
const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
  server: "sandbox", // Use "production" for live
});
```

### Local Webhook Testing

```bash
# Install ngrok
brew install ngrok

# Start tunnel
ngrok http 3000

# Use the ngrok URL in Polar dashboard:
# https://xxxx.ngrok.io/api/webhooks/polar
```

### Test Subscription Flow

1. Create a test product in Polar sandbox
2. Generate a checkout link
3. Complete checkout with test payment
4. Verify webhook events are received

## Customer Portal

Polar provides a hosted customer portal for subscription management:

```typescript
// Get customer portal URL
const portalUrl = `https://polar.sh/purchases/${polarCustomerId}`;

// Or use API to get portal session
const session = await polar.customerPortal.sessions.create({
  customerId: polarCustomerId,
});
// Redirect to session.url
```

## License Keys

For products with license key benefits:

```typescript
// Validate a license key
const validation = await polar.licenseKeys.validate({
  key: "LICENSE_KEY",
  organizationId: POLAR_ORG_ID,
});

if (validation.valid) {
  // License is valid
  console.log("Customer:", validation.customer);
  console.log("Benefit:", validation.benefit);
}

// Activate a license key
const activation = await polar.licenseKeys.activate({
  key: "LICENSE_KEY",
  organizationId: POLAR_ORG_ID,
  label: "Device Name",
});
```

## Products API

```typescript
// List products
const products = await polar.products.list({
  organizationId: POLAR_ORG_ID,
  isArchived: false,
});

// Get specific product
const product = await polar.products.get({
  id: POLAR_PRODUCT_ID,
});
```

## Security Best Practices

1. **Never expose access token** - Use `POLAR_ACCESS_TOKEN` only server-side
2. **Verify webhook signatures** - Always use `validateEvent` from SDK
3. **Idempotency** - Store reference IDs to prevent duplicate processing
4. **Use metadata** - Store userId in checkout/subscription metadata
5. **Sandbox first** - Test thoroughly in sandbox before production

## Common Issues

| Issue | Solution |
|-------|----------|
| Webhook signature invalid | Ensure using raw body, correct secret |
| Duplicate credit grants | Implement referenceId deduplication |
| Subscription not syncing | Check webhook event registration in Polar dashboard |
| Checkout failing | Verify product ID and organization ID |
| Portal not loading | Ensure customer has valid Polar customer ID |

## Pricing Model

Polar charges **4% + 40¢ per successful transaction** with no monthly fees. They act as Merchant of Record, handling all international tax compliance.

## Useful Resources

- [Polar Dashboard](https://polar.sh/dashboard)
- [Polar Documentation](https://polar.sh/docs)
- [API Reference](https://polar.sh/docs/api)
- [SDK GitHub](https://github.com/polarsource/polar)
