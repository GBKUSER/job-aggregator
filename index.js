const express = require("express");
const app = express();

app.use(express.json());

// Home
app.get("/", (req, res) => {
  res.send("Job Aggregator is running 🚀");
});

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "job-aggregator",
    time: new Date().toISOString()
  });
});

// Jobs endpoint (empty for now)
app.get("/api/jobs", (req, res) => {
  res.json({
    ok: true,
    count: 0,
    jobs: []
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port", PORT);
});
