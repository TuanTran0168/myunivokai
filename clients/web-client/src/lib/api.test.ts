import { describe, it, expect } from "vitest";
import { ApiError, apiErrorMessage } from "./api";

describe("apiErrorMessage", () => {
  it("surfaces the backend field-level validation message instead of the generic one", () => {
    const error = new ApiError(400, {
      error: {
        code: "VALIDATION_ERROR",
        message: "Please check the highlighted fields.",
        details: [{ field: "goal", message: "Goal must be 10-220 characters." }],
        requestId: "req_123"
      }
    });
    expect(apiErrorMessage(error)).toBe("Goal must be 10-220 characters. (req_123)");
  });

  it("joins multiple field messages", () => {
    const error = new ApiError(400, {
      error: {
        message: "Please check the highlighted fields.",
        details: [
          { field: "goal", message: "Goal must be 10-220 characters." },
          { field: "interests", message: "Choose 3-8 interests." }
        ]
      }
    });
    expect(apiErrorMessage(error)).toBe("Goal must be 10-220 characters. Choose 3-8 interests.");
  });

  it("falls back to the generic message when there are no details", () => {
    const error = new ApiError(404, { error: { message: "World not found", requestId: "req_9" } });
    expect(apiErrorMessage(error)).toBe("World not found (req_9)");
  });
});
