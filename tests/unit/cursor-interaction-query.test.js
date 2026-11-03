import { describe, it, expect } from "vitest";
import {
  encodeField,
  decodeMessage,
  parseConnectRPCFrame,
  decodeInteractionQuery,
  encodeInteractionResponseFrame,
} from "../../open-sse/utils/cursorProtobuf.js";

// Cursor AgentService interaction_query auto-response: decode the hosted
// tool query (field 7) and encode the approve/decline reply (field 6).
// Field numbers verified against upstream's cursorAgentProtobuf port.

const LEN = 2;
const VARINT = 0;
const buf = (u8) => Buffer.from(u8);

function serverMessageWithQuery(id, variantField, variantBody = "") {
  const inner = Buffer.concat([
    buf(encodeField(1, VARINT, id)),
    buf(encodeField(variantField, LEN, variantBody)),
  ]);
  return buf(encodeField(7, LEN, inner));
}

function decodeFrame(frame) {
  const parsed = parseConnectRPCFrame(buf(frame));
  expect(parsed).not.toBeNull();
  return decodeMessage(parsed.payload);
}

// Follow one LEN nesting level: decode the bytes of `field` inside `message`.
function step(message, field) {
  const entry = message.get(field)?.[0];
  expect(entry, `expected field ${field}`).toBeDefined();
  return decodeMessage(entry.value);
}

function fieldString(message, field) {
  const entry = message.get(field)?.[0];
  return entry ? Buffer.from(entry.value).toString("utf8") : null;
}

describe("cursor interaction_query", () => {
  it("decodes id and variantField from an interaction_query", () => {
    const msg = serverMessageWithQuery(42, 9, "https://example.com");
    expect(decodeInteractionQuery(msg)).toEqual({ id: 42, variantField: 9 });
  });

  it("returns null without field 7, without a variant, or for empty input", () => {
    expect(decodeInteractionQuery(buf(encodeField(1, LEN, "x")))).toBeNull();
    expect(
      decodeInteractionQuery(buf(encodeField(7, LEN, encodeField(1, VARINT, 5))))
    ).toBeNull();
    expect(decodeInteractionQuery(new Uint8Array())).toBeNull();
    expect(decodeInteractionQuery(null)).toBeNull();
  });

  it("encodes an approval frame for webFetch (9)", () => {
    const frame = encodeInteractionResponseFrame(42, 9);
    expect(frame).not.toBeNull();
    const acm = decodeFrame(frame);
    const ir = step(acm, 6);
    expect(ir.get(1)[0].value).toBe(42);
    const variant = step(ir, 9);
    expect(variant.get(1)[0].value.length).toBe(0);
  });

  it("encodes a rejection frame for askQuestion (3)", () => {
    // variant 3 -> result 1 -> rejected 3 -> reason 1
    const frame = encodeInteractionResponseFrame(101, 3);
    const acm = decodeFrame(frame);
    const ir = step(acm, 6);
    expect(ir.get(1)[0].value).toBe(101);
    const result = step(ir, 3);
    const rejected = step(result, 1);
    const reason = step(rejected, 3);
    expect(fieldString(reason, 1)).toBe("not implemented by this client");
  });

  it("encodes switchMode (4) and createPlan (7) rejections", () => {
    // variant 4 -> rejected 2 -> reason 1
    const frame4 = encodeInteractionResponseFrame(202, 4);
    const ir4 = step(decodeFrame(frame4), 6);
    const rejected4 = step(ir4, 4);
    const reason4 = step(rejected4, 2);
    expect(fieldString(reason4, 1)).toBe("not implemented by this client");

    // variant 7 -> result 1 -> error 2 -> error 1
    const frame7 = encodeInteractionResponseFrame(203, 7);
    const ir7 = step(decodeFrame(frame7), 6);
    const result7 = step(ir7, 7);
    const errWrap7 = step(result7, 1);
    const err7 = step(errWrap7, 2);
    expect(fieldString(err7, 1)).toBe("not implemented by this client");
  });

  it("returns null for setupVm (8) and unknown variants", () => {
    expect(encodeInteractionResponseFrame(204, 8)).toBeNull();
    expect(encodeInteractionResponseFrame(205, 99)).toBeNull();
  });
});
