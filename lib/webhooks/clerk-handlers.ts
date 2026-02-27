import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, gyms, gymMemberships } from "@/lib/db/schema";
import type {
  ClerkUserEventData,
  ClerkUserDeletedEventData,
  ClerkOrganizationEventData,
  ClerkOrgMembershipEventData,
} from "./types";

// --- Helpers ---

const ROLE_MAP: Record<string, string> = {
  "org:admin": "owner",
  "org:trainer": "trainer",
  "org:athlete": "athlete",
};

function buildName(first: string | null, last: string | null, fallbackEmail: string): string {
  const parts = [first, last].filter(Boolean);
  return parts.length > 0 ? parts.join(" ") : fallbackEmail;
}

function getPrimaryEmail(data: ClerkUserEventData): string {
  return data.email_addresses[0]?.email_address ?? "";
}

function mapRole(clerkRole: string): string {
  return ROLE_MAP[clerkRole] ?? "athlete";
}

async function resolveUser(clerkUserId: string) {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkUserId, clerkUserId));
  return rows[0] ?? null;
}

async function resolveGym(clerkOrgId: string) {
  const rows = await db
    .select({ id: gyms.id })
    .from(gyms)
    .where(eq(gyms.clerkOrgId, clerkOrgId));
  return rows[0] ?? null;
}

// --- Handlers ---

export async function handleUserCreated(data: ClerkUserEventData): Promise<void> {
  const email = getPrimaryEmail(data);
  const name = buildName(data.first_name, data.last_name, email);
  const isSuperadmin = data.public_metadata?.is_superadmin === true;

  await db
    .insert(users)
    .values({
      clerkUserId: data.id,
      email,
      name,
      isSuperadmin,
    })
    .onConflictDoNothing();
}

export async function handleUserUpdated(data: ClerkUserEventData): Promise<void> {
  const email = getPrimaryEmail(data);
  const name = buildName(data.first_name, data.last_name, email);
  const isSuperadmin = data.public_metadata?.is_superadmin === true;

  await db
    .update(users)
    .set({ email, name, isSuperadmin })
    .where(eq(users.clerkUserId, data.id))
    .returning({ id: users.id });
}

export async function handleUserDeleted(data: ClerkUserDeletedEventData): Promise<void> {
  const user = await resolveUser(data.id);
  if (!user) return;

  await db
    .update(gymMemberships)
    .set({ isActive: false })
    .where(eq(gymMemberships.userId, user.id))
    .returning({ id: gymMemberships.id });
}

export async function handleOrganizationCreated(data: ClerkOrganizationEventData): Promise<void> {
  console.log(
    `[webhook] organization.created: ${data.id} (${data.name}, slug: ${data.slug})`
  );
}

export async function handleMembershipCreated(data: ClerkOrgMembershipEventData): Promise<void> {
  const user = await resolveUser(data.public_user_data.user_id);
  if (!user) return;

  const gym = await resolveGym(data.organization.id);
  if (!gym) return;

  const role = mapRole(data.role);

  await db
    .insert(gymMemberships)
    .values({
      userId: user.id,
      gymId: gym.id,
      role,
      isActive: true,
    })
    .onConflictDoNothing();
}

export async function handleMembershipUpdated(data: ClerkOrgMembershipEventData): Promise<void> {
  const user = await resolveUser(data.public_user_data.user_id);
  if (!user) return;

  const gym = await resolveGym(data.organization.id);
  if (!gym) return;

  const role = mapRole(data.role);

  await db
    .update(gymMemberships)
    .set({ role })
    .where(
      and(
        eq(gymMemberships.userId, user.id),
        eq(gymMemberships.gymId, gym.id)
      )
    )
    .returning({ id: gymMemberships.id });
}

export async function handleMembershipDeleted(data: ClerkOrgMembershipEventData): Promise<void> {
  const user = await resolveUser(data.public_user_data.user_id);
  if (!user) return;

  const gym = await resolveGym(data.organization.id);
  if (!gym) return;

  await db
    .update(gymMemberships)
    .set({ isActive: false })
    .where(
      and(
        eq(gymMemberships.userId, user.id),
        eq(gymMemberships.gymId, gym.id)
      )
    )
    .returning({ id: gymMemberships.id });
}
