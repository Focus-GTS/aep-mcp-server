import pino from "pino";

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    base: { name: "aep-mcp-server" },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  pino.destination(2),
);
