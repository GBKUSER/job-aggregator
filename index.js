const express = require("express");
const app = express();

app.get("/", (req, res) => res.send("OK: server is up"));
app.get("/api/health", (req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;

// IMPORTANT: bind to 0.0.0.0 for Hostinger containers
app.listen(PORT, "0.0.0.0", () => {
  console.log("Listening on", PORT);
});
