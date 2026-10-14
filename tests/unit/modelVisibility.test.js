import { describe, it, expect } from "vitest";
import { filterModelsByVisibility } from "@/lib/modelVisibility.js";

const M = (id, extra = {}) => ({ id, object: "model", ...extra });
const ids = (list) => list.map((m) => m.id);

describe("filterModelsByVisibility", () => {
  it("keduanya kosong = semua lolos (referensi sama, tanpa filter)", () => {
    const models = [M("openai/gpt-4o"), M("combo-hemat"), M("anthropic/claude")];
    expect(filterModelsByVisibility(models, {})).toBe(models);
    expect(
      ids(filterModelsByVisibility(models, { modelVisibilityAllowlist: [], modelVisibilityDenylist: [] }))
    ).toEqual(["openai/gpt-4o", "combo-hemat", "anthropic/claude"]);
  });

  it("allowlist saja: hanya id yang exact-match yang tampil", () => {
    const models = [M("openai/gpt-4o"), M("openai/gpt-4o-mini"), M("combo-hemat")];
    const out = filterModelsByVisibility(models, {
      modelVisibilityAllowlist: ["openai/gpt-4o", "combo-hemat"],
    });
    expect(ids(out)).toEqual(["openai/gpt-4o", "combo-hemat"]);
  });

  it("denylist saja: yang terdaftar dikecualikan", () => {
    const models = [M("openai/gpt-4o"), M("openai/gpt-4o-mini"), M("combo-hemat")];
    const out = filterModelsByVisibility(models, {
      modelVisibilityDenylist: ["openai/gpt-4o-mini"],
    });
    expect(ids(out)).toEqual(["openai/gpt-4o", "combo-hemat"]);
  });

  it("keduanya: denylist menang atas allowlist", () => {
    const models = [M("openai/gpt-4o"), M("openai/gpt-4o-mini"), M("combo-hemat")];
    const out = filterModelsByVisibility(models, {
      modelVisibilityAllowlist: ["openai/gpt-4o", "openai/gpt-4o-mini"],
      modelVisibilityDenylist: ["openai/gpt-4o-mini"],
    });
    expect(ids(out)).toEqual(["openai/gpt-4o"]);
  });

  it("entri combo (id = nama combo) difilter oleh helper yang sama", () => {
    const models = [
      M("combo-hemat", { owned_by: "combo" }),
      M("combo-mahal", { owned_by: "combo" }),
      M("openai/gpt-4o"),
    ];
    expect(
      ids(filterModelsByVisibility(models, { modelVisibilityDenylist: ["combo-mahal"] }))
    ).toEqual(["combo-hemat", "openai/gpt-4o"]);
    expect(
      ids(filterModelsByVisibility(models, { modelVisibilityAllowlist: ["combo-hemat"] }))
    ).toEqual(["combo-hemat"]);
  });

  it("nilai non-string di list/settings diabaikan, tidak crash", () => {
    const models = [M("a"), { id: 123 }, null, M("b")];
    const out = filterModelsByVisibility(models, {
      modelVisibilityAllowlist: ["a", 42, null],
      modelVisibilityDenylist: "bukan-array",
    });
    expect(ids(out)).toEqual(["a"]);
  });
});
