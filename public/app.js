const SAMPLE_MESSAGES = {
  "new-client":
    "Hi, we are looking for help managing a strata property in Brisbane. Can someone contact us with pricing and explain how onboarding works?",
  urgent:
    "The tenant says the ceiling is leaking again and water damage is spreading through the hallway. Please treat this urgently and let us know the next step.",
  billing:
    "Could you explain why our latest invoice is higher than last month and confirm whether the extra maintenance charge is correct?",
  complaint:
    "I emailed last week and still have not received a response. This delay is very disappointing and I want someone to address it today.",
  unclear: "Can you help with the thing from before? It is still not sorted and we need an answer soon.",
};

const form = document.getElementById("analysisForm");
const messageField = document.getElementById("message");
const charCount = document.getElementById("charCount");
const formError = document.getElementById("formError");
const submitButton = document.getElementById("submitButton");
const clearButton = document.getElementById("clearButton");
const sampleButtons = Array.from(document.querySelectorAll(".sample-button"));

const emptyState = document.getElementById("emptyState");
const resultPanel = document.getElementById("resultPanel");
const statusBadge = document.getElementById("statusBadge");
const categoryValue = document.getElementById("categoryValue");
const confidenceValue = document.getElementById("confidenceValue");
const riskValue = document.getElementById("riskValue");
const secondarySignalValue = document.getElementById("secondarySignalValue");
const summaryValue = document.getElementById("summaryValue");
const actionValue = document.getElementById("actionValue");
const responseValue = document.getElementById("responseValue");
const providerValue = document.getElementById("providerValue");
const modelValue = document.getElementById("modelValue");
const responseTimeValue = document.getElementById("responseTimeValue");
const reviewBanner = document.getElementById("reviewBanner");
const resultSourceBanner = document.getElementById("resultSourceBanner");
const reviewReasonList = document.getElementById("reviewReasonList");
const copyResponseButton = document.getElementById("copyResponseButton");

function setStatus(label, className) {
  statusBadge.textContent = label;
  statusBadge.className = `status-badge ${className}`;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  clearButton.disabled = isBusy;
  sampleButtons.forEach((button) => {
    button.disabled = isBusy;
  });
}

function updateCharCount() {
  charCount.textContent = `${messageField.value.length} / 4000`;
}

function showError(message) {
  formError.hidden = false;
  formError.textContent = message;
}

function clearError() {
  formError.hidden = true;
  formError.textContent = "";
}

function renderReviewReasons(reasons) {
  if (!reasons || reasons.length === 0) {
    reviewReasonList.hidden = true;
    reviewReasonList.innerHTML = "";
    return;
  }

  reviewReasonList.hidden = false;
  reviewReasonList.innerHTML = `
    <p><strong>Why this was flagged</strong></p>
    <ul>${reasons.map((reason) => `<li>${reason}</li>`).join("")}</ul>
  `;
}

function renderResultSource(meta, data) {
  const isFallback = meta.resultSource === "fallback";

  resultSourceBanner.hidden = false;
  resultSourceBanner.innerHTML = isFallback
    ? `<p><strong>Fallback result:</strong> The live AI response was not available, so the app returned a safe manual-review outcome.${data.fallback_reason ? ` Reason: ${data.fallback_reason}` : ""}</p>`
    : "<p><strong>Live AI result:</strong> This output came from the configured language model and was checked against the expected schema.</p>";
}

function renderResult(payload) {
  emptyState.hidden = true;
  resultPanel.hidden = false;

  categoryValue.textContent = payload.data.category;
  confidenceValue.textContent = `${Math.round(payload.data.confidence * 100)}%`;
  riskValue.textContent = payload.data.risk_level;
  secondarySignalValue.textContent = payload.data.secondary_signal;
  summaryValue.textContent = payload.data.summary;
  actionValue.textContent = payload.data.recommended_action;
  responseValue.textContent = payload.data.suggested_response;
  providerValue.textContent = `Provider: ${payload.meta.provider}`;
  modelValue.textContent = `Model: ${payload.meta.model}`;
  responseTimeValue.textContent = `Response time: ${payload.meta.responseTimeMs} ms`;

  reviewBanner.hidden = !payload.data.needs_review;
  renderResultSource(payload.meta, payload.data);
  renderReviewReasons(payload.data.review_reasons || []);

  if (payload.data.needs_review) {
    setStatus("Needs review", "status-review");
  } else {
    setStatus("Ready for staff review", "status-ready");
  }
}

async function copySuggestedResponse() {
  if (!responseValue.textContent || responseValue.textContent === "-") {
    return;
  }

  try {
    await navigator.clipboard.writeText(responseValue.textContent);
    copyResponseButton.textContent = "Copied";
    setTimeout(() => {
      copyResponseButton.textContent = "Copy suggested response";
    }, 1500);
  } catch (_error) {
    copyResponseButton.textContent = "Copy failed";
    setTimeout(() => {
      copyResponseButton.textContent = "Copy suggested response";
    }, 1500);
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  clearError();

  const message = messageField.value.trim();
  if (!message) {
    showError("Please enter a client enquiry first.");
    return;
  }

  setBusy(true);
  setStatus("Analyzing...", "status-loading");

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message }),
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Unable to analyze the enquiry.");
    }

    renderResult(payload);
  } catch (error) {
    setStatus("Error", "status-review");
    showError(error.message || "Something went wrong while analyzing the enquiry.");
  } finally {
    setBusy(false);
  }
}

messageField.addEventListener("input", updateCharCount);
form.addEventListener("submit", handleSubmit);
copyResponseButton.addEventListener("click", copySuggestedResponse);

clearButton.addEventListener("click", () => {
  messageField.value = "";
  updateCharCount();
  clearError();
  emptyState.hidden = false;
  resultPanel.hidden = true;
  reviewBanner.hidden = true;
  resultSourceBanner.hidden = true;
  reviewReasonList.hidden = true;
  resultSourceBanner.innerHTML = "";
  reviewReasonList.innerHTML = "";
  responseTimeValue.textContent = "Response time: -";
  copyResponseButton.textContent = "Copy suggested response";
  setStatus("Waiting for input", "status-idle");
});

sampleButtons.forEach((button) => {
  button.addEventListener("click", () => {
    messageField.value = SAMPLE_MESSAGES[button.dataset.sample] || "";
    updateCharCount();
    clearError();
  });
});

updateCharCount();
