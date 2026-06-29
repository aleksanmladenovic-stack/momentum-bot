const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const projectRoot = path.join(__dirname, "..", "..");
const env = process.env.NODE_ENV;
let envFileName = ".env";

if (env === "production") {
  envFileName = ".env.production";
} else if (env === "development") {
  envFileName = ".env.development";
}

const resolveEnvPath = () => {
  const primary = path.join(projectRoot, envFileName);
  if (fs.existsSync(primary)) {
    return primary;
  }
  if (envFileName !== ".env") {
    const fallback = path.join(projectRoot, ".env");
    if (fs.existsSync(fallback)) {
      return fallback;
    }
  }
  return primary;
};

dotenv.config({ path: resolveEnvPath(), override: true });

const buildConfig = () => {
  const password = process.env.PG_PASSWORD ?? "123456";

  return {
    username: process.env.PG_USERNAME || "smith",
    password,
    database: process.env.PG_DB || "smith",
    host: process.env.PG_HOST || "localhost",
    port: Number(process.env.PG_PORT || 5432),
    dialect: "postgres",
  };
};

const config = buildConfig();

module.exports = {
  development: config,
  production: config,
  test: config,
};
