// @vitest-environment node
import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { withGymScope, withGymScopeAnd } from "../../utils/gym-scope";
import { athletes } from "../schema/athletes";
import { sessions } from "../schema/sessions";
import { hrReadings } from "../schema/hr-readings";
import * as schema from "../schema";

// Create a mock DB for .toSQL() inspection (no real connection needed)
const mockDb = drizzle.mock({ schema });

const GYM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GYM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

describe("Multi-Tenant Query Isolation", () => {
  describe("athletes queries", () => {
    it("should include gym_id filter when using withGymScope", () => {
      const query = mockDb
        .select()
        .from(athletes)
        .where(withGymScope(athletes.gymId, GYM_A))
        .toSQL();

      expect(query.sql).toContain('"athletes"."gym_id"');
      expect(query.params).toContain(GYM_A);
    });

    it("should scope to different gyms with different IDs", () => {
      const queryA = mockDb
        .select()
        .from(athletes)
        .where(withGymScope(athletes.gymId, GYM_A))
        .toSQL();

      const queryB = mockDb
        .select()
        .from(athletes)
        .where(withGymScope(athletes.gymId, GYM_B))
        .toSQL();

      expect(queryA.params).toContain(GYM_A);
      expect(queryA.params).not.toContain(GYM_B);

      expect(queryB.params).toContain(GYM_B);
      expect(queryB.params).not.toContain(GYM_A);
    });

    it("should compose gym scope with additional filters", () => {
      const query = mockDb
        .select()
        .from(athletes)
        .where(
          withGymScopeAnd(
            athletes.gymId,
            GYM_A,
            eq(athletes.isActive, true)
          )
        )
        .toSQL();

      expect(query.sql).toContain('"athletes"."gym_id"');
      expect(query.sql).toContain('"athletes"."is_active"');
      expect(query.params).toContain(GYM_A);
    });
  });

  describe("sessions queries", () => {
    it("should include gym_id filter for session queries", () => {
      const query = mockDb
        .select()
        .from(sessions)
        .where(withGymScope(sessions.gymId, GYM_A))
        .toSQL();

      expect(query.sql).toContain('"sessions"."gym_id"');
      expect(query.params).toContain(GYM_A);
    });

    it("should compose gym scope with status filter for active sessions", () => {
      const query = mockDb
        .select()
        .from(sessions)
        .where(
          withGymScopeAnd(
            sessions.gymId,
            GYM_A,
            eq(sessions.status, "active")
          )
        )
        .toSQL();

      expect(query.sql).toContain('"sessions"."gym_id"');
      expect(query.sql).toContain('"sessions"."status"');
      expect(query.params).toContain(GYM_A);
      expect(query.params).toContain("active");
    });
  });

  describe("hr_readings queries", () => {
    it("should include gym_id filter for HR readings", () => {
      const query = mockDb
        .select()
        .from(hrReadings)
        .where(withGymScope(hrReadings.gymId, GYM_A))
        .toSQL();

      expect(query.sql).toContain('"hr_readings"."gym_id"');
      expect(query.params).toContain(GYM_A);
    });
  });

  describe("cross-tenant isolation", () => {
    it("should produce different SQL params for different gyms on the same table", () => {
      const queriesA = [
        mockDb.select().from(athletes).where(withGymScope(athletes.gymId, GYM_A)).toSQL(),
        mockDb.select().from(sessions).where(withGymScope(sessions.gymId, GYM_A)).toSQL(),
        mockDb.select().from(hrReadings).where(withGymScope(hrReadings.gymId, GYM_A)).toSQL(),
      ];

      const queriesB = [
        mockDb.select().from(athletes).where(withGymScope(athletes.gymId, GYM_B)).toSQL(),
        mockDb.select().from(sessions).where(withGymScope(sessions.gymId, GYM_B)).toSQL(),
        mockDb.select().from(hrReadings).where(withGymScope(hrReadings.gymId, GYM_B)).toSQL(),
      ];

      for (let i = 0; i < queriesA.length; i++) {
        // Same SQL structure
        expect(queriesA[i].sql).toBe(queriesB[i].sql);
        // Different params (gym IDs)
        expect(queriesA[i].params).not.toEqual(queriesB[i].params);
      }
    });
  });
});
