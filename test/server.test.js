const test = require("node:test");
const assert = require("node:assert/strict");

const { createApp } = require("../src/server");

async function withServer(app, run) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await run(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }
}

function createTestApp(overrides = {}) {
  return createApp({
    analyzeEnquiry: overrides.analyzeEnquiry,
    getProvider: () => "test-provider",
    getModelName: () => "test-model",
    logEvent: () => {},
  });
}

test("POST /api/analyze returns live analysis metadata", async () => {
  const app = createTestApp({
    analyzeEnquiry: async () => ({
      analysis: {
        category: "billing/accounts",
        secondary_signal: "complaint",
        risk_level: "medium",
        confidence: 0.91,
        summary: "Client questions an invoice increase and is unhappy with the delay.",
        recommended_action: "Clarify the invoice increase and acknowledge the complaint.",
        suggested_response:
          "Thank you for raising this. We will review the invoice and follow up with an explanation shortly.",
        needs_review: true,
        review_reasons: ["The enquiry mixes billing and complaint signals, so staff review is safer."],
      },
      modelUsed: "mock-live-model",
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message:
          "I am disappointed that nobody has replied about the invoice increase and I need this billing issue explained.",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.meta.resultSource, "live");
    assert.equal(payload.meta.model, "mock-live-model");
    assert.ok(payload.meta.requestId);
    assert.equal(response.headers.get("x-request-id"), payload.meta.requestId);
  });
});

test("POST /api/analyze returns safe fallback metadata when provider fails", async () => {
  const app = createTestApp({
    analyzeEnquiry: async () => {
      throw new Error("503 provider unavailable");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Please explain why our invoice is higher this month and why no one replied.",
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.meta.resultSource, "fallback");
    assert.equal(payload.meta.fallback, true);
    assert.equal(payload.data.category, "unclear/needs review");
    assert.match(payload.data.fallback_reason, /temporarily unavailable|503/i);
  });
});

test("POST /api/analyze/batch processes multiple enquiries", async () => {
  const app = createTestApp({
    analyzeEnquiry: async (message) => ({
      analysis: {
        category: message.includes("invoice") ? "billing/accounts" : "general question",
        secondary_signal: "none",
        risk_level: "low",
        confidence: 0.95,
        summary: "Structured analysis result.",
        recommended_action: "Review the enquiry and route it appropriately.",
        suggested_response: "Thank you for your message. We will review it shortly.",
        needs_review: false,
        review_reasons: [],
      },
      modelUsed: "batch-model",
    }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          "Please explain why our invoice is higher this month.",
          "Can you tell me what your onboarding process looks like?",
        ],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.meta.count, 2);
    assert.equal(payload.data.length, 2);
    assert.equal(payload.data[0].meta.resultSource, "live");
    assert.equal(payload.data[1].data.category, "general question");
  });
});

test("POST /api/analyze/batch rejects invalid items with indexed error metadata", async () => {
  const app = createTestApp({
    analyzeEnquiry: async () => {
      throw new Error("should not be called");
    },
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/analyze/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: ["Please explain why our invoice is higher this month.", "help please"],
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 400);
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.meta.path, ["messages", 1]);
  });
});
