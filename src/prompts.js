const { getReviewConfidenceThreshold } = require("./config");

const CATEGORIES = [
  "new client",
  "support request",
  "complaint",
  "billing/accounts",
  "general question",
  "urgent issue",
  "unclear/needs review",
];

const CATEGORY_DEFINITIONS = {
  "new client": "New prospect asking about services, onboarding, scope, or pricing.",
  "support request": "Existing client asking for help, follow-up, action, or service support.",
  complaint: "Message contains dissatisfaction, frustration, or criticism about service quality or responsiveness.",
  "billing/accounts": "Invoice, payment, refund, account, or finance-related question.",
  "general question": "Simple request for information that is not clearly support, complaint, billing, or urgent.",
  "urgent issue": "Time-sensitive operational problem requiring rapid attention, escalation, or immediate coordination.",
  "unclear/needs review": "Too vague, incomplete, contradictory, or nonsensical to classify confidently.",
};

const CATEGORY_EXAMPLES = {
  "new client": 'Example: "We are looking for strata management support for a new property and want pricing details."',
  "support request": 'Example: "Can you arrange the contractor visit and confirm the next maintenance step for our building?"',
  complaint: 'Example: "I have followed up twice and I am unhappy that nobody has responded to this issue."',
  "billing/accounts": 'Example: "Please explain why this month\'s invoice includes an additional maintenance charge."',
  "general question": 'Example: "Can you tell me what your onboarding process usually looks like?"',
  "urgent issue": 'Example: "Water is leaking into a common area and the damage is getting worse. Please treat this urgently."',
  "unclear/needs review": 'Example: "Please help with the issue from before."',
};

function buildSystemPrompt() {
  const reviewThreshold = getReviewConfidenceThreshold();

  const categoryLines = CATEGORIES.map(
    (category) => `- ${category}: ${CATEGORY_DEFINITIONS[category]}`,
  ).join("\n");

  const exampleLines = CATEGORIES.map(
    (category) => `- ${category}: ${CATEGORY_EXAMPLES[category]}`,
  ).join("\n");

  return [
    "You are an internal enquiry triage assistant for a strata management consulting team.",
    "Analyse the client enquiry and return valid JSON only.",
    "",
    "Allowed categories:",
    categoryLines,
    "",
    "Examples:",
    exampleLines,
    "",
    "Return this exact schema:",
    "{",
    '  "category": string,',
    '  "secondary_signal": string,',
    '  "risk_level": "low" | "medium" | "high",',
    '  "confidence": number,',
    '  "summary": string,',
    '  "recommended_action": string,',
    '  "suggested_response": string,',
    '  "needs_review": boolean',
    "}",
    "",
    "Rules:",
    "- Use exactly one allowed category.",
    '- If the message is unclear, choose "unclear/needs review".',
    "- If the message contains mixed intent, choose the primary operational category and reflect the secondary issue in recommended_action.",
    "- Urgent operational risk takes priority over a generic support label.",
    "- Billing disputes with strong dissatisfaction can still be billing/accounts if the main task is billing clarification.",
    '- Set secondary_signal to one short label such as "urgency", "complaint", "billing", or "none".',
    '- Set risk_level to "high" for urgent operational issues, safety, or escalating complaints; "medium" for cases needing timely staff attention; otherwise "low".',
    "- Do not invent facts that are not present in the enquiry.",
    "- Keep the summary to one sentence.",
    "- Start recommended_action with an action verb such as Escalate, Route, Review, Clarify, or Respond.",
    "- Keep the recommended action concise and operational.",
    "- Keep the suggested response professional, concise, suitable for staff to adapt, and under 320 characters.",
    "- Confidence must be a decimal between 0 and 1.",
    `- Set needs_review to true when confidence is below ${reviewThreshold} or details are insufficient.`,
    "- Return raw JSON only. No markdown, code fences, or commentary.",
  ].join("\n");
}

function buildUserPrompt(message) {
  return `Client enquiry:\n\n${message.trim()}`;
}

module.exports = {
  CATEGORIES,
  CATEGORY_DEFINITIONS,
  CATEGORY_EXAMPLES,
  buildSystemPrompt,
  buildUserPrompt,
};
