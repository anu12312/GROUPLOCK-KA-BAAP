const express = require("express");
const fs = require("fs");
const path = require("path");
const bodyParser = require("body-parser");
const { startBot, stopBot, getLogs } = require("./bot"); // bot logic

const app = express();
app.use(bodyParser.json());
const PORT = process.env.PORT || 3000;

// Serve HTML + assets
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Start bot endpoint
app.post("/start-bot", async (req, res) => {
  const { appstate, admin } = req.body;
  if (!appstate || !admin) return res.status(400).send("❌ Missing AppState or UID!");
  try {
    await startBot(admin, appstate);
    res.send(`✅ Bot started for UID: ${admin}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Failed to start bot");
  }
});

// Stop bot endpoint
app.get("/stop-bot", async (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).send("❌ Missing UID!");
  try {
    await stopBot(uid);
    res.send(`🛑 Bot stopped for UID: ${uid}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Failed to stop bot");
  }
});

// Logs endpoint
app.get("/logs", (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).send("❌ Missing UID!");
  const log = getLogs(uid);
  res.send(log);
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
