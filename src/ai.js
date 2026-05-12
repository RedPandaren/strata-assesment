const { GoogleGenerativeAI } = require("@google/generative-ai");
const OpenAI = require("openai");

const { buildSystemPrompt, buildUserPrompt } = require("./prompts");
const { normalizeAnalysis } = require("./validator");

function getProvider() {
  return (process.env.LLM_PROVIDER || "gemini").trim().toLowerCase();
}

function getModelName() {
  const provider = getProvider();

  if (process.env.MODEL_NAME) {
    return process.env.MODEL_NAME;
  }

  return provider === "openai" ? "gpt-4.1-mini" : "gemini-2.0-flash";
}

function stripCodeFences(text) {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function parseJsonResponse(rawText) {
  const cleaned = stripCodeFences(rawText);
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonSlice = firstBrace >= 0 && lastBrace >= 0 ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;

  return JSON.parse(jsonSlice);
}

function getGeminiFallbackModels() {
  return [
    process.env.MODEL_NAME,
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
  ].filter(Boolean);
}

function withTimeout(promise, timeoutMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]);
}

async function analyzeWithGemini(message) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const prompt = `${buildSystemPrompt()}\n\n${buildUserPrompt(message)}`;
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 20000;
  const models = getGeminiFallbackModels();
  const errors = [];

  for (const modelName of models) {
    try {
      const model = client.getGenerativeModel({ model: modelName });
      const result = await withTimeout(
        model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
        timeoutMs,
        `Gemini model ${modelName}`,
      );

      return {
        rawText: result.response.text(),
        modelUsed: modelName,
      };
    } catch (error) {
      errors.push(`${modelName}: ${error.message}`);
    }
  }

  throw new Error(`Gemini request failed across fallback models. ${errors.join(" | ")}`);
}

async function analyzeWithOpenAI(message) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const timeoutMs = Number(process.env.LLM_TIMEOUT_MS) || 20000;
  const response = await withTimeout(
    client.responses.create({
      model: getModelName(),
      temperature: 0.2,
      input: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt(message) },
      ],
    }),
    timeoutMs,
    "OpenAI request",
  );

  return {
    rawText: response.output_text,
    modelUsed: getModelName(),
  };
}

async function analyzeEnquiry(message) {
  const provider = getProvider();
  let result;

  if (provider === "openai") {
    result = await analyzeWithOpenAI(message);
  } else {
    result = await analyzeWithGemini(message);
  }

  return {
    analysis: normalizeAnalysis(parseJsonResponse(result.rawText), message),
    modelUsed: result.modelUsed,
  };
}

module.exports = {
  analyzeEnquiry,
  getModelName,
  getProvider,
};
