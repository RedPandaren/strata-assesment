const { z } = require("zod");

const { getBatchLimit, getReviewConfidenceThreshold } = require("./config");

const ALLOWED_CATEGORIES = [
  "new client",
  "support request",
  "complaint",
  "billing/accounts",
  "general question",
  "urgent issue",
  "unclear/needs review",
];

const requestSchema = z.object({
  message: z
    .string({ required_error: "Message is required." })
    .trim()
    .min(8, "Please enter a fuller enquiry so the AI can classify it reliably.")
    .max(4000, "Enquiry is too long for this prototype. Please keep it under 4000 characters."),
});

const batchRequestSchema = z.object({
  messages: z
    .array(z.string(), {
      required_error: "Messages are required.",
    })
    .min(1, "Provide at least one enquiry to analyze.")
    .max(getBatchLimit(), `Batch limit exceeded. Please send at most ${getBatchLimit()} enquiries.`),
});

const analysisSchema = z.object({
  category: z.enum(ALLOWED_CATEGORIES),
  secondary_signal: z.string().trim().min(1).max(40),
  risk_level: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
  summary: z.string().trim().min(1).max(280),
  recommended_action: z.string().trim().min(1).max(280),
  suggested_response: z.string().trim().min(1).max(500),
  needs_review: z.boolean(),
});

const MIXED_INTENT_KEYWORDS = {
  complaint: ["disappointed", "unacceptable", "frustrated", "complaint", "no response", "still have not"],
  "billing/accounts": ["invoice", "billing", "payment", "refund", "charge", "account"],
  "urgent issue": ["urgent", "immediately", "asap", "leak", "leaking", "damage", "storm", "unsafe"],
};

const ACTION_VERBS = ["acknowledge", "arrange", "assign", "clarify", "contact", "escalate", "follow", "investigate", "notify", "respond", "review", "route", "schedule"];

function getWeakInputReason(message) {
  const trimmed = message.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const alphaMatches = trimmed.match(/[a-z]/gi) || [];
  const uniqueWords = new Set(words.map((word) => word.toLowerCase()));

  if (alphaMatches.length < 6) {
    return "Please include a meaningful enquiry with enough context for classification.";
  }

  if (words.length < 4) {
    return "Please enter a fuller enquiry so the AI can classify it reliably.";
  }

  if (uniqueWords.size <= 2 && words.length >= 4) {
    return "Please avoid repeated placeholder text and include the actual enquiry details.";
  }

  if (!/[?.!]/.test(trimmed) && words.length < 6) {
    return "Please provide a little more detail so the enquiry can be reviewed properly.";
  }

  return null;
}

function validateRequest(payload) {
  const parsed = requestSchema.parse(payload);
  const weakInputReason = getWeakInputReason(parsed.message);

  if (weakInputReason) {
    throw new z.ZodError([
      {
        code: "custom",
        message: weakInputReason,
        path: ["message"],
      },
    ]);
  }

  return parsed;
}

function validateBatchRequest(payload) {
  const parsed = batchRequestSchema.parse(payload);

  return {
    messages: parsed.messages.map((message, index) => {
      try {
        return validateRequest({ message }).message;
      } catch (error) {
        if (error instanceof z.ZodError) {
          const issue = error.issues[0];

          throw new z.ZodError([
            {
              ...issue,
              path: ["messages", index],
            },
          ]);
        }

        throw error;
      }
    }),
  };
}

function detectReviewReasons(message, analysis) {
  const loweredMessage = message.trim().toLowerCase();
  const reasons = [];

  if (analysis.category === "unclear/needs review") {
    reasons.push("Category is unclear and should be reviewed manually.");
  }

  if (analysis.confidence < getReviewConfidenceThreshold()) {
    reasons.push("Model confidence is below the review threshold.");
  }

  if (loweredMessage.split(/\s+/).filter(Boolean).length < 8) {
    reasons.push("The original enquiry is brief and may lack enough context.");
  }

  const hasBillingSignal = MIXED_INTENT_KEYWORDS["billing/accounts"].some((keyword) => loweredMessage.includes(keyword));
  const hasComplaintSignal = MIXED_INTENT_KEYWORDS.complaint.some((keyword) => loweredMessage.includes(keyword));
  const hasUrgentSignal = MIXED_INTENT_KEYWORDS["urgent issue"].some((keyword) => loweredMessage.includes(keyword));

  if (hasBillingSignal && hasComplaintSignal) {
    reasons.push("The enquiry mixes billing and complaint signals, so staff review is safer.");
  }

  if (hasUrgentSignal && analysis.category !== "urgent issue") {
    reasons.push("The message contains urgent operational language that may need escalation.");
  }

  if (analysis.risk_level === "high" && analysis.category !== "urgent issue" && !hasComplaintSignal) {
    reasons.push("The model marked this as high risk without a clearly urgent category.");
  }

  return reasons;
}

function inferSecondarySignal(message, category) {
  const loweredMessage = message.trim().toLowerCase();
  const signalMatches = [
    ["urgency", MIXED_INTENT_KEYWORDS["urgent issue"]],
    ["billing", MIXED_INTENT_KEYWORDS["billing/accounts"]],
    ["complaint", MIXED_INTENT_KEYWORDS.complaint],
  ].filter(([, keywords]) => keywords.some((keyword) => loweredMessage.includes(keyword)));

  if (signalMatches.length === 0) {
    return "none";
  }

  const firstSignal = signalMatches[0][0];
  if (firstSignal === "urgency" && category === "urgent issue") {
    return signalMatches[1]?.[0] || "none";
  }
  if (firstSignal === "billing" && category === "billing/accounts") {
    return signalMatches[1]?.[0] || "none";
  }
  if (firstSignal === "complaint" && category === "complaint") {
    return signalMatches[1]?.[0] || "none";
  }

  return firstSignal;
}

function inferRiskLevel(message, category, confidence, reviewReasons) {
  const loweredMessage = message.trim().toLowerCase();
  const hasUrgentSignal = MIXED_INTENT_KEYWORDS["urgent issue"].some((keyword) => loweredMessage.includes(keyword));
  const hasComplaintSignal = MIXED_INTENT_KEYWORDS.complaint.some((keyword) => loweredMessage.includes(keyword));

  if (category === "urgent issue" || hasUrgentSignal) {
    return "high";
  }

  if (
    category === "complaint" ||
    hasComplaintSignal ||
    reviewReasons.length > 0 ||
    confidence < getReviewConfidenceThreshold()
  ) {
    return "medium";
  }

  return "low";
}

function normalizeActionText(action) {
  const trimmed = action.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase();

  if (ACTION_VERBS.includes(firstWord)) {
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  }

  return `Review ${trimmed.charAt(0).toLowerCase()}${trimmed.slice(1)}`;
}

function summarizeFallbackReason(reason) {
  if (!reason) {
    return "Unknown provider error.";
  }

  if (reason.includes("timed out")) {
    return "The AI provider timed out before returning a result.";
  }

  if (reason.includes("429")) {
    return "The AI provider rate limit or quota was exceeded.";
  }

  if (reason.includes("503")) {
    return "The AI provider was temporarily unavailable or under heavy demand.";
  }

  if (reason.includes("404")) {
    return "The configured model was not available for this request.";
  }

  return reason.length > 180 ? `${reason.slice(0, 177)}...` : reason;
}

function normalizeAnalysis(rawAnalysis, message) {
  const normalized = {
    category: rawAnalysis.category,
    secondary_signal: typeof rawAnalysis.secondary_signal === "string" ? rawAnalysis.secondary_signal : "none",
    risk_level: rawAnalysis.risk_level,
    confidence:
      typeof rawAnalysis.confidence === "string"
        ? Number(rawAnalysis.confidence)
        : rawAnalysis.confidence,
    summary: rawAnalysis.summary,
    recommended_action: normalizeActionText(rawAnalysis.recommended_action),
    suggested_response: rawAnalysis.suggested_response,
    needs_review: rawAnalysis.needs_review,
  };

  const reviewReasons = detectReviewReasons(message, normalized);

  normalized.secondary_signal = inferSecondarySignal(message, normalized.category) || normalized.secondary_signal;
  normalized.risk_level = inferRiskLevel(message, normalized.category, normalized.confidence, reviewReasons);

  if (reviewReasons.length > 0) {
    normalized.needs_review = true;
  }

  return {
    ...analysisSchema.parse(normalized),
    review_reasons: reviewReasons,
  };
}

function createFallbackAnalysis(reason) {
  return {
    category: "unclear/needs review",
    secondary_signal: "none",
    risk_level: "medium",
    confidence: 0,
    summary: "Unable to classify automatically.",
    recommended_action: "Manual review required.",
    suggested_response:
      "Thanks for your message. A staff member will review this enquiry manually and follow up shortly.",
    needs_review: true,
    fallback_reason: summarizeFallbackReason(reason),
  };
}

module.exports = {
  ALLOWED_CATEGORIES,
  analysisSchema,
  batchRequestSchema,
  createFallbackAnalysis,
  detectReviewReasons,
  normalizeAnalysis,
  validateBatchRequest,
  validateRequest,
};
