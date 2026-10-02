/**
 * Regression test untuk #4283
 *
 * Gemini Antigravity menolak tool schema yang mengandung keyword JSON Schema
 * yang tidak dikenal dengan: "Unknown name X: Cannot find field."
 *
 * Daftar UNSUPPORTED_SCHEMA_CONSTRAINTS di gemini.js belum mencakup
 * "errorMessage" (dan keyword anotasi non-standar serupa yang dipakai sebagian
 * skema tool MCP), menyebabkan error 400 INVALID_ARGUMENT pada tool yang punya
 * field dokumentasi error.
 *
 * Fix: tambah errorMessage, errorMessages, markdownDescription, dan keyword
 * anotasi non-standar lain ke daftar strip.
 */

import { describe, it, expect } from "vitest";
import { cleanJSONSchemaForAntigravity, UNSUPPORTED_SCHEMA_CONSTRAINTS } from "../../open-sse/translator/formats/gemini.js";

describe("UNSUPPORTED_SCHEMA_CONSTRAINTS mencakup keyword anotasi non-standar (#4283)", () => {
  it("mencakup errorMessage", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("errorMessage");
  });
  it("mencakup errorMessages", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("errorMessages");
  });
  it("mencakup markdownDescription", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("markdownDescription");
  });
  it("mencakup minProperties", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("minProperties");
  });
  it("mencakup maxProperties", () => {
    expect(UNSUPPORTED_SCHEMA_CONSTRAINTS).toContain("maxProperties");
  });
});

describe("cleanJSONSchemaForAntigravity membuang errorMessage secara rekursif (#4283)", () => {
  it("membuang errorMessage di level teratas", () => {
    const schema = {
      type: "object",
      properties: {
        code: { type: "integer" }
      },
      errorMessage: "Invalid input"
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result).not.toHaveProperty("errorMessage");
  });

  it("membuang errorMessage di dalam array items", () => {
    const schema = {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: {
            type: "string",
            errorMessage: "Must be a non-empty string"
          }
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.tags.items).not.toHaveProperty("errorMessage");
  });

  it("membuang markdownDescription dari property nested", () => {
    const schema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          markdownDescription: "The **name** of the resource"
        }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.properties.name).not.toHaveProperty("markdownDescription");
  });

  it("membuang minProperties / maxProperties", () => {
    const schema = {
      type: "object",
      minProperties: 1,
      maxProperties: 10,
      properties: { x: { type: "string" } }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result).not.toHaveProperty("minProperties");
    expect(result).not.toHaveProperty("maxProperties");
  });

  it("membiarkan field valid lainnya utuh", () => {
    const schema = {
      type: "object",
      description: "A valid tool",
      properties: {
        n: { type: "number", description: "A number" }
      }
    };
    const result = cleanJSONSchemaForAntigravity(structuredClone(schema));
    expect(result.description).toBe("A valid tool");
    expect(result.properties.n.description).toBe("A number");
  });
});
