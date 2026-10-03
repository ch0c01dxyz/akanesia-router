import { describe, it, expect } from "vitest";
import { resolvePonytailOverride } from "../../open-sse/rtk/ponytail.js";

describe("resolvePonytailOverride", () => {
  it("null bila tidak ada header (pakai setting global)", () => {
    expect(resolvePonytailOverride({}, true, "full")).toBeNull();
    expect(resolvePonytailOverride(undefined, true, "full")).toBeNull();
    expect(resolvePonytailOverride({ "x-9router-ponytail": "" }, true, "full")).toBeNull();
    expect(resolvePonytailOverride({ "x-9router-ponytail": "   " }, true, "full")).toBeNull();
  });

  it("null untuk nilai tak dikenal (pakai setting global)", () => {
    expect(resolvePonytailOverride({ "x-9router-ponytail": "turbo" }, true, "full")).toBeNull();
  });

  it("off mematikan (berbagai varian)", () => {
    for (const v of ["off", "OFF", " Off ", "0", "false", "disabled", "no"]) {
      expect(resolvePonytailOverride({ "x-9router-ponytail": v }, true, "full")).toEqual({
        enabled: false,
        level: "full",
      });
    }
  });

  it("level valid mengaktifkan dengan level tersebut", () => {
    expect(resolvePonytailOverride({ "x-9router-ponytail": "lite" }, false, "full")).toEqual({
      enabled: true,
      level: "lite",
    });
    expect(resolvePonytailOverride({ "x-9router-ponytail": "ULTRA" }, false, "full")).toEqual({
      enabled: true,
      level: "ultra",
    });
    expect(resolvePonytailOverride({ "x-9router-ponytail": " Full " }, true, "lite")).toEqual({
      enabled: true,
      level: "full",
    });
  });
});
