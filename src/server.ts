import { buildApp } from "./app";
import { env } from "./config/env";

async function start() {
  const app = buildApp();
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
