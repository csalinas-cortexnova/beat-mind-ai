// @vitest-environment node
import { describe, it, expect } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  gyms,
  subscriptionStatusEnum,
  users,
  gymMemberships,
  gymMembershipRoleEnum,
  athletes,
  athleteBands,
  sessions,
  sessionStatusEnum,
  hrReadings,
  sessionAthletes,
  aiCoachingMessages,
  agents,
  agentStatusEnum,
  hrBands,
  hrBandStatusEnum,
} from "../index";

describe("Schema Definitions", () => {
  describe("gyms table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(gyms);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("slug");
      expect(columnNames).toContain("address");
      expect(columnNames).toContain("phone");
      expect(columnNames).toContain("timezone");
      expect(columnNames).toContain("language");
      expect(columnNames).toContain("clerkOrgId");
      expect(columnNames).toContain("tvAccessToken");
      expect(columnNames).toContain("subscriptionStatus");
      expect(columnNames).toContain("subscriptionPlan");
      expect(columnNames).toContain("maxAthletes");
      expect(columnNames).toContain("logoUrl");
      expect(columnNames).toContain("primaryColor");
      expect(columnNames).toContain("secondaryColor");
      expect(columnNames).toContain("createdAt");
      expect(columnNames).toContain("updatedAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(gyms);
      expect(Object.keys(columns)).toHaveLength(17);
    });
  });

  describe("users table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(users);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("clerkUserId");
      expect(columnNames).toContain("email");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("phone");
      expect(columnNames).toContain("isSuperadmin");
      expect(columnNames).toContain("createdAt");
      expect(columnNames).toContain("updatedAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(users);
      expect(Object.keys(columns)).toHaveLength(8);
    });
  });

  describe("gym_memberships table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(gymMemberships);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("userId");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("role");
      expect(columnNames).toContain("isActive");
      expect(columnNames).toContain("createdAt");
      expect(columnNames).toContain("updatedAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(gymMemberships);
      expect(Object.keys(columns)).toHaveLength(7);
    });
  });

  describe("athletes table", () => {
    it("should have all required columns including gender from Spec 12", () => {
      const columns = getTableColumns(athletes);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("userId");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("email");
      expect(columnNames).toContain("phone");
      expect(columnNames).toContain("age");
      expect(columnNames).toContain("gender");
      expect(columnNames).toContain("weightKg");
      expect(columnNames).toContain("maxHr");
      expect(columnNames).toContain("whatsappOptIn");
      expect(columnNames).toContain("isActive");
      expect(columnNames).toContain("createdAt");
      expect(columnNames).toContain("updatedAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(athletes);
      expect(Object.keys(columns)).toHaveLength(14);
    });
  });

  describe("athlete_bands table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(athleteBands);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("athleteId");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("sensorId");
      expect(columnNames).toContain("bandLabel");
      expect(columnNames).toContain("isActive");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(athleteBands);
      expect(Object.keys(columns)).toHaveLength(7);
    });
  });

  describe("sessions table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(sessions);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("trainerId");
      expect(columnNames).toContain("classType");
      expect(columnNames).toContain("status");
      expect(columnNames).toContain("startedAt");
      expect(columnNames).toContain("endedAt");
      expect(columnNames).toContain("durationSeconds");
      expect(columnNames).toContain("athleteCount");
      expect(columnNames).toContain("aiSummary");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(sessions);
      expect(Object.keys(columns)).toHaveLength(11);
    });
  });

  describe("hr_readings table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(hrReadings);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("sessionId");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("athleteId");
      expect(columnNames).toContain("sensorId");
      expect(columnNames).toContain("heartRateBpm");
      expect(columnNames).toContain("hrZone");
      expect(columnNames).toContain("hrZoneName");
      expect(columnNames).toContain("hrZoneColor");
      expect(columnNames).toContain("hrMaxPercent");
      expect(columnNames).toContain("beatTime");
      expect(columnNames).toContain("beatCount");
      expect(columnNames).toContain("deviceActive");
      expect(columnNames).toContain("recordedAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(hrReadings);
      expect(Object.keys(columns)).toHaveLength(14);
    });

    it("should use bigserial for id (mode: number)", () => {
      const columns = getTableColumns(hrReadings);
      expect(columns.id.dataType).toBe("number");
    });
  });

  describe("session_athletes table", () => {
    it("should have all required columns including Spec 12 additions", () => {
      const columns = getTableColumns(sessionAthletes);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("sessionId");
      expect(columnNames).toContain("athleteId");
      expect(columnNames).toContain("sensorId");
      expect(columnNames).toContain("avgHr");
      expect(columnNames).toContain("maxHr");
      expect(columnNames).toContain("minHr");
      expect(columnNames).toContain("calories");
      expect(columnNames).toContain("timeZone1S");
      expect(columnNames).toContain("timeZone2S");
      expect(columnNames).toContain("timeZone3S");
      expect(columnNames).toContain("timeZone4S");
      expect(columnNames).toContain("timeZone5S");
      expect(columnNames).toContain("joinedAt");
      expect(columnNames).toContain("leftAt");
      expect(columnNames).toContain("reportToken");
      expect(columnNames).toContain("whatsappSentAt");
      expect(columnNames).toContain("whatsappStatus");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(sessionAthletes);
      expect(Object.keys(columns)).toHaveLength(19);
    });
  });

  describe("ai_coaching_messages table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(aiCoachingMessages);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("sessionId");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("message");
      expect(columnNames).toContain("model");
      expect(columnNames).toContain("athleteSummaries");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(aiCoachingMessages);
      expect(Object.keys(columns)).toHaveLength(7);
    });
  });

  describe("agents table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(agents);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("agentSecret");
      expect(columnNames).toContain("name");
      expect(columnNames).toContain("hardwareModel");
      expect(columnNames).toContain("serialNumber");
      expect(columnNames).toContain("status");
      expect(columnNames).toContain("lastHeartbeat");
      expect(columnNames).toContain("ipAddress");
      expect(columnNames).toContain("softwareVersion");
      expect(columnNames).toContain("config");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(agents);
      expect(Object.keys(columns)).toHaveLength(12);
    });
  });

  describe("hr_bands table", () => {
    it("should have all required columns", () => {
      const columns = getTableColumns(hrBands);
      const columnNames = Object.keys(columns);

      expect(columnNames).toContain("id");
      expect(columnNames).toContain("gymId");
      expect(columnNames).toContain("sensorId");
      expect(columnNames).toContain("bandLabel");
      expect(columnNames).toContain("brand");
      expect(columnNames).toContain("model");
      expect(columnNames).toContain("status");
      expect(columnNames).toContain("purchasedAt");
      expect(columnNames).toContain("notes");
      expect(columnNames).toContain("createdAt");
    });

    it("should have correct column count", () => {
      const columns = getTableColumns(hrBands);
      expect(Object.keys(columns)).toHaveLength(10);
    });
  });
});

describe("Enum Values", () => {
  it("subscriptionStatusEnum should have correct values", () => {
    expect(subscriptionStatusEnum).toEqual(["active", "suspended", "cancelled"]);
  });

  it("gymMembershipRoleEnum should have correct values", () => {
    expect(gymMembershipRoleEnum).toEqual(["owner", "trainer", "athlete"]);
  });

  it("sessionStatusEnum should have correct values", () => {
    expect(sessionStatusEnum).toEqual(["active", "completed", "cancelled"]);
  });

  it("agentStatusEnum should have correct values", () => {
    expect(agentStatusEnum).toEqual(["online", "offline", "maintenance"]);
  });

  it("hrBandStatusEnum should have correct values", () => {
    expect(hrBandStatusEnum).toEqual(["active", "damaged", "lost"]);
  });
});

describe("Table Names", () => {
  it("all tables should have correct SQL table names", () => {
    expect(getTableName(gyms)).toBe("gyms");
    expect(getTableName(users)).toBe("users");
    expect(getTableName(gymMemberships)).toBe("gym_memberships");
    expect(getTableName(athletes)).toBe("athletes");
    expect(getTableName(athleteBands)).toBe("athlete_bands");
    expect(getTableName(sessions)).toBe("sessions");
    expect(getTableName(hrReadings)).toBe("hr_readings");
    expect(getTableName(sessionAthletes)).toBe("session_athletes");
    expect(getTableName(aiCoachingMessages)).toBe("ai_coaching_messages");
    expect(getTableName(agents)).toBe("agents");
    expect(getTableName(hrBands)).toBe("hr_bands");
  });
});
