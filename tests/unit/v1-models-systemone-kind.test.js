import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  buildModelsList: vi.fn(),
}));

vi.mock("../../src/app/api/v1/models/route.js", () => ({
  buildModelsList: mocks.buildModelsList,
}));

const { GET } = await import("../../src/app/api/v1/models/[...model]/route.js");

function params(model) {
  return { params: Promise.resolve({ model }) };
}

describe("GET /v1/models/systemone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists decisions-capable models through the systemone kind filter", async () => {
    const systemoneModels = [
      { id: "nace/drex-max", object: "model", owned_by: "nace" },
      { id: "v1m/v1m-decision-engine", object: "model", owned_by: "v1m" },
    ];
    mocks.buildModelsList.mockResolvedValue(systemoneModels);

    const response = await GET(
      new Request("https://router.test/v1/models/systemone"),
      params(["systemone"])
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ object: "list", data: systemoneModels });
    expect(mocks.buildModelsList).toHaveBeenCalledWith(["systemone"]);
  });
});
