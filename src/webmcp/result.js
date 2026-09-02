/**
 * The envelope every tool returns, and the one it returns when it cannot.
 *
 * An error is only useful to an agent if it says what to do differently, so
 * `fail` takes a hint and every caller is expected to write one. "Invalid id"
 * makes a model give up or invent a workaround; "ids look like clip-... , call
 * list_clips" makes it retry correctly.
 */

export const json = (payload) => ({
  content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
});

export const fail = (error, hint) => ({
  content: [{ type: "text", text: JSON.stringify({ ok: false, error, hint }, null, 2) }],
  isError: true,
});

/** Every schema is closed. Narrow inputs are the documented recommendation, and
 *  a broad "do the thinking for me" tool is the documented anti-pattern. */
export const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };

export const READ_ONLY = { readOnlyHint: true };
