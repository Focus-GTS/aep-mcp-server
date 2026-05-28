import pino from "pino";

const VALID_LOG_LEVELS = new Set([
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
]);

const requestedLevel = process.env.LOG_LEVEL ?? "info";
const level = VALID_LOG_LEVELS.has(requestedLevel) ? requestedLevel : "info";

export const logger = pino(
  {
    level,
    base: { name: "aep-mcp-server" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [
        "*.client_secret",
        "*.access_token",
        "*.refresh_token",
        "*.Authorization",
        "*.authorization",
        "headers.authorization",
        "headers.Authorization",
        'headers["x-api-key"]',
        "body.client_secret",
        "body.access_token",
        "*.email",
        "*.entityId",
        "*.identityValue",
        "*.phone",
        "*.clientSecret",
        "*.token",
      ],
      censor: "[REDACTED]",
    },
  },
  pino.destination(2),
);
