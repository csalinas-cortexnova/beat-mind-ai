/**
 * Database seed script for development.
 * Usage: npx tsx lib/db/seed.ts
 *
 * Creates sample data: 2 gyms, users, athletes, bands, agents.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { gyms } from "./schema/gyms";
import { users } from "./schema/users";
import { gymMemberships } from "./schema/gym-memberships";
import { athletes } from "./schema/athletes";
import { athleteBands } from "./schema/athlete-bands";
import { agents } from "./schema/agents";
import { hrBands } from "./schema/hr-bands";

async function seed() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const db = drizzle(pool);

  console.log("Seeding database...");

  // --- Gyms ---
  const [gym1, gym2] = await db
    .insert(gyms)
    .values([
      {
        name: "Iron Pulse Fitness",
        slug: "iron-pulse",
        address: "Av. Paulista 1000, São Paulo, SP",
        phone: "+5511999990001",
        timezone: "America/Sao_Paulo",
        language: "pt-BR",
        clerkOrgId: "org_seed_iron_pulse",
        subscriptionStatus: "active",
        subscriptionPlan: "pro",
        maxAthletes: 30,
        primaryColor: "#FF6B00",
        secondaryColor: "#1A1A2E",
      },
      {
        name: "Cycle Studio BCN",
        slug: "cycle-bcn",
        address: "Carrer de Mallorca 250, Barcelona",
        phone: "+34600000001",
        timezone: "Europe/Madrid",
        language: "es",
        clerkOrgId: "org_seed_cycle_bcn",
        subscriptionStatus: "active",
        subscriptionPlan: "starter",
        maxAthletes: 20,
        primaryColor: "#2563EB",
        secondaryColor: "#F8FAFC",
      },
    ])
    .returning();

  // --- Users ---
  const seedUsers = await db
    .insert(users)
    .values([
      {
        clerkUserId: "user_seed_superadmin",
        email: "admin@beatmind.ai",
        name: "BeatMind Admin",
        isSuperadmin: true,
      },
      {
        clerkUserId: "user_seed_owner1",
        email: "owner@ironpulse.com",
        name: "Carlos Ferreira",
        phone: "+5511999990002",
      },
      {
        clerkUserId: "user_seed_trainer1",
        email: "trainer@ironpulse.com",
        name: "Ana Santos",
        phone: "+5511999990003",
      },
      {
        clerkUserId: "user_seed_owner2",
        email: "owner@cyclebcn.com",
        name: "Maria Garcia",
        phone: "+34600000002",
      },
    ])
    .returning();

  const owner1 = seedUsers[1];
  const trainer1 = seedUsers[2];
  const owner2 = seedUsers[3];

  // --- Gym Memberships ---
  await db.insert(gymMemberships).values([
    { userId: owner1.id, gymId: gym1.id, role: "owner" },
    { userId: trainer1.id, gymId: gym1.id, role: "trainer" },
    { userId: owner2.id, gymId: gym2.id, role: "owner" },
  ]);

  // --- Athletes (Gym 1) ---
  const gym1Athletes = await db
    .insert(athletes)
    .values([
      {
        gymId: gym1.id,
        name: "Lucas Oliveira",
        email: "lucas@email.com",
        phone: "+5511988880001",
        age: 28,
        gender: "male",
        weightKg: "78.50",
        maxHr: 192,
        whatsappOptIn: true,
      },
      {
        gymId: gym1.id,
        name: "Fernanda Lima",
        email: "fernanda@email.com",
        phone: "+5511988880002",
        age: 32,
        gender: "female",
        weightKg: "62.00",
        maxHr: 188,
        whatsappOptIn: true,
      },
      {
        gymId: gym1.id,
        name: "Rafael Costa",
        email: "rafael@email.com",
        age: 45,
        gender: "male",
        weightKg: "90.00",
        maxHr: 175,
        whatsappOptIn: false,
      },
    ])
    .returning();

  // --- Athletes (Gym 2) ---
  const gym2Athletes = await db
    .insert(athletes)
    .values([
      {
        gymId: gym2.id,
        name: "Pablo Martínez",
        email: "pablo@email.com",
        phone: "+34611000001",
        age: 25,
        gender: "male",
        weightKg: "72.00",
        maxHr: 195,
        whatsappOptIn: true,
      },
      {
        gymId: gym2.id,
        name: "Elena Ruiz",
        email: "elena@email.com",
        age: 30,
        gender: "female",
        weightKg: "58.00",
        maxHr: 190,
        whatsappOptIn: false,
      },
    ])
    .returning();

  // --- Athlete Bands ---
  await db.insert(athleteBands).values([
    { athleteId: gym1Athletes[0].id, gymId: gym1.id, sensorId: 101, bandLabel: "Band #1" },
    { athleteId: gym1Athletes[1].id, gymId: gym1.id, sensorId: 102, bandLabel: "Band #2" },
    { athleteId: gym1Athletes[2].id, gymId: gym1.id, sensorId: 103, bandLabel: "Band #3" },
    { athleteId: gym2Athletes[0].id, gymId: gym2.id, sensorId: 101, bandLabel: "Banda A" },
    { athleteId: gym2Athletes[1].id, gymId: gym2.id, sensorId: 102, bandLabel: "Banda B" },
  ]);

  // --- HR Bands (inventory) ---
  await db.insert(hrBands).values([
    { gymId: gym1.id, sensorId: 101, bandLabel: "Band #1", brand: "Garmin", model: "HRM-Dual", status: "active" },
    { gymId: gym1.id, sensorId: 102, bandLabel: "Band #2", brand: "Garmin", model: "HRM-Dual", status: "active" },
    { gymId: gym1.id, sensorId: 103, bandLabel: "Band #3", brand: "Wahoo", model: "TICKR", status: "active" },
    { gymId: gym2.id, sensorId: 101, bandLabel: "Banda A", brand: "Polar", model: "H10", status: "active" },
    { gymId: gym2.id, sensorId: 102, bandLabel: "Banda B", brand: "Polar", model: "H10", status: "active" },
  ]);

  // --- Agents ---
  await db.insert(agents).values([
    {
      gymId: gym1.id,
      agentSecret: "seed_secret_gym1_agent1",
      name: "Iron Pulse Agent 1",
      hardwareModel: "Beelink Mini S12 Pro",
      serialNumber: "IP-AGENT-001",
      status: "offline",
      config: { antDongleCount: 2, readingIntervalMs: 1000, bufferMaxMinutes: 10 },
    },
    {
      gymId: gym2.id,
      agentSecret: "seed_secret_gym2_agent1",
      name: "Cycle BCN Agent 1",
      hardwareModel: "Intel NUC 12",
      serialNumber: "CB-AGENT-001",
      status: "offline",
      config: { antDongleCount: 1, readingIntervalMs: 1000, bufferMaxMinutes: 10 },
    },
  ]);

  console.log("Seed complete!");
  console.log(`  - 2 gyms created`);
  console.log(`  - 4 users created (1 superadmin, 2 owners, 1 trainer)`);
  console.log(`  - 5 athletes created (3 gym1, 2 gym2)`);
  console.log(`  - 5 athlete bands assigned`);
  console.log(`  - 5 HR bands in inventory`);
  console.log(`  - 2 agents registered`);

  await pool.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
