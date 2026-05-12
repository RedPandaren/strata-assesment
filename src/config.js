function getPort() {
  return Number(process.env.PORT) || 3000;
}

function getReviewConfidenceThreshold() {
  const rawValue = Number(process.env.REVIEW_CONFIDENCE_THRESHOLD);

  if (Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 1) {
    return rawValue;
  }

  return 0.8;
}

function getBatchLimit() {
  const rawValue = Number(process.env.BATCH_LIMIT);

  if (Number.isInteger(rawValue) && rawValue > 0) {
    return rawValue;
  }

  return 10;
}

module.exports = {
  getBatchLimit,
  getPort,
  getReviewConfidenceThreshold,
};
