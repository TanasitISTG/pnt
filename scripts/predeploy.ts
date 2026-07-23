import { execSync } from "node:child_process";

console.log("Running predeploy migrations...");

try {
  execSync("bun run db:migrate", { stdio: "inherit" });
  console.log("Predeploy migrations completed successfully.");
} catch (error) {
  console.error("Predeploy migrations failed:", error);
  process.exit(1);
}
