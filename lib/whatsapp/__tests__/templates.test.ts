// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildSessionReportTemplate, type TemplateData } from "../templates";

describe("buildSessionReportTemplate", () => {
  const baseData: TemplateData = {
    athleteName: "Maria",
    classType: "Spinning",
    gymName: "PowerGym",
    duration: "45:30",
    avgHr: 145,
    calories: 420,
    reportUrl: "https://app.beatmind.ai/reports/session/abc/def?token=xyz",
  };

  it("should return correct param order matching template placeholders", () => {
    const result = buildSessionReportTemplate(baseData);

    expect(result.templateName).toBe("session_report");
    expect(result.params).toEqual([
      "Maria",        // 1: athleteName
      "Spinning",     // 2: classType
      "PowerGym",     // 3: gymName
      "45:30",        // 4: duration
      "145",          // 5: avgHr (stringified)
      "420",          // 6: calories (stringified)
      "https://app.beatmind.ai/reports/session/abc/def?token=xyz", // 7: reportUrl
    ]);
    expect(result.params).toHaveLength(7);
  });

  it("should stringify all numeric params", () => {
    const result = buildSessionReportTemplate(baseData);

    // avgHr and calories should be strings
    expect(typeof result.params[4]).toBe("string"); // avgHr
    expect(typeof result.params[5]).toBe("string"); // calories
    // All params should be strings
    result.params.forEach((param, i) => {
      expect(typeof param).toBe("string");
    });
  });

  it("should use default class type when not provided", () => {
    const data: TemplateData = { ...baseData, classType: "" };
    const result = buildSessionReportTemplate(data);

    // When classType is empty, it should default to "Clase"
    expect(result.params[1]).toBe("Clase");
  });
});
