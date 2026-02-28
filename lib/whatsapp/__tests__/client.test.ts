// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Hoisted mocks ──────────────────────────────────────────────────────────

const { mockCreate, mockLog } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockLog: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("twilio", () => ({
  default: vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

vi.mock("@/lib/logger", () => ({
  log: mockLog,
}));

import { sendWhatsAppMessage, maskPhone, _testing } from "../client";

describe("WhatsApp Client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _testing.resetClient();
    vi.useFakeTimers();

    // Set env vars for Twilio
    process.env.TWILIO_ACCOUNT_SID = "ACtest123";
    process.env.TWILIO_AUTH_TOKEN = "token123";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+14155238886";
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_WHATSAPP_FROM;
  });

  describe("maskPhone", () => {
    it("should mask middle digits of phone number", () => {
      expect(maskPhone("+5511999998888")).toBe("+55****8888");
    });

    it("should return **** for short phone numbers", () => {
      expect(maskPhone("+1234")).toBe("****");
    });
  });

  describe("sendWhatsAppMessage", () => {
    it("should return success with messageSid on successful send", async () => {
      mockCreate.mockResolvedValue({ sid: "SM1234567890" });

      const result = await sendWhatsAppMessage({
        to: "+5511999998888",
        templateName: "session_report",
        templateParams: ["Maria", "Spinning", "GymX"],
      });

      expect(result).toEqual({
        success: true,
        messageSid: "SM1234567890",
      });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith({
        from: "whatsapp:+14155238886",
        to: "whatsapp:+5511999998888",
        body: "Maria | Spinning | GymX",
      });
    });

    it("should retry after 30s on first failure and return success on retry", async () => {
      mockCreate
        .mockRejectedValueOnce(new Error("Network timeout"))
        .mockResolvedValueOnce({ sid: "SM_RETRY_OK" });

      const promise = sendWhatsAppMessage({
        to: "+5511999998888",
        templateName: "session_report",
        templateParams: ["Maria"],
      });

      // First attempt fails immediately, then waits 30s
      await vi.advanceTimersByTimeAsync(30_000);

      const result = await promise;

      expect(result).toEqual({
        success: true,
        messageSid: "SM_RETRY_OK",
      });
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockLog.warn).toHaveBeenCalledWith(
        "WhatsApp send failed, retrying in 30s",
        expect.objectContaining({ module: "whatsapp" })
      );
    });

    it("should return failure after both attempts fail", async () => {
      const error = new Error("Service unavailable");
      (error as unknown as { code: number }).code = 503;
      mockCreate.mockRejectedValue(error);

      const promise = sendWhatsAppMessage({
        to: "+5511999998888",
        templateName: "session_report",
        templateParams: ["Maria"],
      });

      await vi.advanceTimersByTimeAsync(30_000);

      const result = await promise;

      expect(result).toEqual({
        success: false,
        errorCode: "503",
        errorMessage: "Service unavailable",
      });
      expect(mockCreate).toHaveBeenCalledTimes(2);
      expect(mockLog.error).toHaveBeenCalledWith(
        "WhatsApp send failed after retry",
        expect.objectContaining({ module: "whatsapp" })
      );
    });

    it("should handle Twilio error with error code", async () => {
      const twilioError = new Error("Invalid phone number");
      (twilioError as unknown as { code: number }).code = 21211;
      mockCreate.mockRejectedValue(twilioError);

      const promise = sendWhatsAppMessage({
        to: "+000",
        templateName: "session_report",
        templateParams: ["Test"],
      });

      await vi.advanceTimersByTimeAsync(30_000);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("21211");
      expect(result.errorMessage).toBe("Invalid phone number");
    });

    it("should return error when Twilio client is not configured", async () => {
      _testing.resetClient();
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;

      const result = await sendWhatsAppMessage({
        to: "+5511999998888",
        templateName: "session_report",
        templateParams: ["Maria"],
      });

      expect(result).toEqual({
        success: false,
        errorMessage: "Twilio client not configured",
      });
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
