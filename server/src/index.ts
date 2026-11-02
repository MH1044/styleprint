import { createApp } from "./app.js";
import { PORT } from "./env.js";

const app = createApp();

app.listen(PORT, () => {
  console.log(`voicebox server listening on http://localhost:${PORT}`);
});
