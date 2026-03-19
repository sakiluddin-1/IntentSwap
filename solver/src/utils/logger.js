import { createLogger as winstonCreateLogger, format, transports } from "winston";
import { config } from "../config/config.js";

export function createLogger(module) {
  return winstonCreateLogger({
    level: config.monitoring.logLevel,
    format: format.combine(
      format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      format.errors({ stack: true }),
      format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
        return `${timestamp} [${level.toUpperCase()}] [${module}] ${message}${metaStr}`;
      })
    ),
    transports: [
      new transports.Console(),
      new transports.File({ filename: "logs/error.log", level: "error" }),
      new transports.File({ filename: "logs/solver.log" }),
    ],
  });
}
