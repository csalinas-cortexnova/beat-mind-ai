import { Webhook } from "svix";
import { NextResponse } from "next/server";
import {
  handleUserCreated,
  handleUserUpdated,
  handleUserDeleted,
  handleOrganizationCreated,
  handleMembershipCreated,
  handleMembershipUpdated,
  handleMembershipDeleted,
} from "@/lib/webhooks/clerk-handlers";

export async function POST(request: Request) {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: "Missing svix headers" },
      { status: 400 }
    );
  }

  const body = await request.text();

  let event: { type: string; data: unknown };
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as { type: string; data: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "user.created":
        await handleUserCreated(event.data as Parameters<typeof handleUserCreated>[0]);
        break;
      case "user.updated":
        await handleUserUpdated(event.data as Parameters<typeof handleUserUpdated>[0]);
        break;
      case "user.deleted":
        await handleUserDeleted(event.data as Parameters<typeof handleUserDeleted>[0]);
        break;
      case "organization.created":
        await handleOrganizationCreated(event.data as Parameters<typeof handleOrganizationCreated>[0]);
        break;
      case "organizationMembership.created":
        await handleMembershipCreated(event.data as Parameters<typeof handleMembershipCreated>[0]);
        break;
      case "organizationMembership.updated":
        await handleMembershipUpdated(event.data as Parameters<typeof handleMembershipUpdated>[0]);
        break;
      case "organizationMembership.deleted":
        await handleMembershipDeleted(event.data as Parameters<typeof handleMembershipDeleted>[0]);
        break;
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[webhook] Handler error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
