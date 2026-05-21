// src/server.ts
import { createApp } from "./app";
import { FileMockMeridianClient } from "./meridian/mock-client";
import { DATA_DIR, PORT } from "./config";

const client = new FileMockMeridianClient(DATA_DIR);
const app = createApp(client);

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `earn-products listening on http://0.0.0.0:${PORT} (data dir: ${DATA_DIR})`,
  );
});
