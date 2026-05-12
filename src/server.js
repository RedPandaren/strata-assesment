const crypto = require("crypto");
const path = require("path");

const dotenv = require("dotenv");
const express = require("express");
const { ZodError } = require("zod");

const runtimePort = process.env.PORT;

dotenv.config({ override: true });

if (runtimePort) {
  process.env.PORT = runtimePort;
}

const aiModule = require("./ai");
const { getBatchLimit, getPort, getReviewConfidenceThreshold } = require("./config");
const { logEvent } = require("./logger");
const {
  createFallbackAnalysis,
  validateBatchRequest,
  validateRequest,
} = require("./validator");

function buildMeta(req, options = {}) {
  return {
    requestId: req.requestId,
    provider: options.provider,
    model: options.model,
    resultSource: options.resultSource,
    responseTimeMs: options.responseTimeMs,
    reviewConfidenceThreshold: getReviewConfidenceThreshold(),
    batchLimit: getBatchLimit(),
    ...(options.fallback ? { fallback: true } : {}),
  };
}

async function analyzeSingleMessage(message, req, services) {
  const startedAt = Date.now();

  try {
    const { analysis, modelUsed } = await services.analyzeEnquiry(message);

    return {
      ok: true,
      data: analysis,
      meta: buildMeta(req, {
        provider: services.getProvider(),
        model: modelUsed || services.getModelName(),
        resultSource: "live",
        responseTimeMs: Date.now() - startedAt,
      }),
    };
  } catch (error) {
    const fallback = createFallbackAnalysis(error.message);

    return {
      ok: true,
      data: fallback,
      meta: buildMeta(req, {
        provider: services.getProvider(),
        model: services.getModelName(),
        resultSource: "fallback",
        responseTimeMs: Date.now() - startedAt,
        fallback: true,
      }),
    };
  }
}

function createApp(services = {}) {
  const app = express();
  const resolvedServices = {
    analyzeEnquiry: services.analyzeEnquiry || aiModule.analyzeEnquiry,
    getModelName: services.getModelName || aiModule.getModelName,
    getProvider: services.getProvider || aiModule.getProvider,
    logEvent: services.logEvent || logEvent,
  };

  app.use(express.json({ limit: "1mb" }));
  app.use((req, res, next) => {
    const startedAt = Date.now();

    req.requestId = req.headers["x-request-id"] || crypto.randomUUID();
    res.setHeader("x-request-id", req.requestId);

    res.on("finish", () => {
      resolvedServices.logEvent("request.completed", {
        requestId: req.requestId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  });
  app.use(express.static(path.join(__dirname, "..", "public")));

  app.get("/api/health", (_req, res) => {
    const provider = resolvedServices.getProvider();

    res.json({
      ok: true,
      provider,
      model: resolvedServices.getModelName(),
      config: {
        reviewConfidenceThreshold: getReviewConfidenceThreshold(),
        batchLimit: getBatchLimit(),
        providerConfigured:
          provider === "openai"
            ? Boolean(process.env.OPENAI_API_KEY)
            : Boolean(process.env.GEMINI_API_KEY),
      },
    });
  });

  app.post("/api/analyze", async (req, res) => {
    try {
      const { message } = validateRequest(req.body);
      const payload = await analyzeSingleMessage(message, req, resolvedServices);

      return res.json(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          ok: false,
          error: error.issues[0]?.message || "Invalid request.",
          meta: {
            requestId: req.requestId,
          },
        });
      }

      throw error;
    }
  });

  app.post("/api/analyze/batch", async (req, res) => {
    try {
      const { messages } = validateBatchRequest(req.body);
      const results = await Promise.all(
        messages.map(async (message, index) => {
          const payload = await analyzeSingleMessage(message, req, resolvedServices);

          return {
            index,
            message,
            ...payload,
          };
        }),
      );

      return res.json({
        ok: true,
        data: results,
        meta: {
          requestId: req.requestId,
          provider: resolvedServices.getProvider(),
          model: resolvedServices.getModelName(),
          count: results.length,
          batchLimit: getBatchLimit(),
          reviewConfidenceThreshold: getReviewConfidenceThreshold(),
        },
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          ok: false,
          error: error.issues[0]?.message || "Invalid batch request.",
          meta: {
            requestId: req.requestId,
            path: error.issues[0]?.path || [],
          },
        });
      }

      throw error;
    }
  });

  app.use((req, res) => {
    res.status(404).json({
      ok: false,
      error: `Route not found: ${req.method} ${req.path}`,
      meta: {
        requestId: req.requestId,
      },
    });
  });

  app.use((error, req, res, _next) => {
    resolvedServices.logEvent("request.failed", {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      error: error.message,
    });

    res.status(500).json({
      ok: false,
      error: "Internal server error.",
      meta: {
        requestId: req.requestId,
      },
    });
  });

  return app;
}

function startServer() {
  const port = getPort();
  const app = createApp();

  return app.listen(port, () => {
    logEvent("server.started", {
      port,
      url: `http://localhost:${port}`,
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  analyzeSingleMessage,
  createApp,
  startServer,
};
