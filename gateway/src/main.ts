import { loadGatewayConfig } from "./config.js";
import { loadLocalGatewayEnvironment } from "./localEnvironment.js";
import { createGatewayServer } from "./server.js";

const config = loadGatewayConfig(loadLocalGatewayEnvironment());
const server = createGatewayServer(config, {
  audit: (event) => console.info(JSON.stringify(event)),
});

server.listen(config.port, "127.0.0.1", () => {
  const configuredProviders = [
    config.openAiApiKey ? "openai" : undefined,
    config.geminiApiKey ? "gemini" : undefined,
    config.modelProvider === "local-demo" ? "local-demo" : undefined,
  ].filter(Boolean);
  const providerStatus =
    configuredProviders.length > 0
      ? configuredProviders.join(", ")
      : "no cloud provider configured";

  console.info(
    `AI gateway listening on 127.0.0.1:${config.port} (providers: ${providerStatus}; default: ${config.modelProvider}).`,
  );
});
