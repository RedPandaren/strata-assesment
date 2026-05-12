const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeAnalysis, validateBatchRequest, validateRequest } = require("../src/validator");

test("validateRequest accepts a meaningful enquiry", () => {
  const result = validateRequest({
    message: "Please explain why our latest invoice includes an additional maintenance charge.",
  });

  assert.equal(
    result.message,
    "Please explain why our latest invoice includes an additional maintenance charge.",
  );
});

test("validateRequest rejects weak placeholder input", () => {
  assert.throws(
    () => validateRequest({ message: "help help help help" }),
    /actual enquiry details|classify it reliably/,
  );
});

test("validateBatchRequest validates each message and reports the failing index", () => {
  assert.throws(
    () => validateBatchRequest({
      messages: [
        "Please explain why our invoice is higher this month.",
        "help help help help",
      ],
    }),
    (error) => {
      assert.equal(error.issues[0].path[0], "messages");
      assert.equal(error.issues[0].path[1], 1);
      return true;
    },
  );
});

test("normalizeAnalysis flags mixed billing complaints for manual review", () => {
  const message =
    "I am disappointed that nobody has replied about the invoice increase and I need this billing issue explained.";
  const result = normalizeAnalysis(
    {
      category: "billing/accounts",
      secondary_signal: "none",
      risk_level: "low",
      confidence: 0.93,
      summary: "Client disputes an invoice increase and expresses dissatisfaction with the lack of response.",
      recommended_action: "clarify the invoice increase and reply to the client",
      suggested_response:
        "Thank you for flagging this. We will review the invoice increase and respond with clarification shortly.",
      needs_review: false,
    },
    message,
  );

  assert.equal(result.category, "billing/accounts");
  assert.equal(result.secondary_signal, "complaint");
  assert.equal(result.needs_review, true);
  assert.match(
    result.review_reasons.join(" "),
    /mixes billing and complaint signals/i,
  );
  assert.match(result.recommended_action, /^Clarify /);
});
