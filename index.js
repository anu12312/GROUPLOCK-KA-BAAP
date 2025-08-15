const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "public"))); // your HTML panel in public/

let botProcess = null;

// Start Bot
app.post("/start", (req, res) => {
  const { uid, appstate } = req.body;
  if (!uid || !appstate) return res.status(400).send("❌ UID or AppState missing");

  const userDir = path.join(__dirname, "users", uid);
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });

  const appStatePath = path.join(userDir, "appstate.json");
  fs.writeFileSync(appStatePath, appstate, "utf-8");

  const adminPath = path.join(userDir, "admin.txt");
  fs.writeFileSync(adminPath, uid, "utf-8"); // Admin UID same as input

  // Kill existing bot if running
  if (botProcess) botProcess.kill();

  // Spawn bot.js
  botProcess = spawn("node", ["bot.js", uid], { stdio: "inherit" });

  res.send("✅ Bot starting...");
});

// Stop Bot
app.post("/stop", (req, res) => {
  if (botProcess) {
    botProcess.kill();
    botProcess = null;
    return res.send("🛑 Bot stopped");
  }
  res.send("❌ Bot was not running");
});

// Bot Status
app.get("/status", (req, res) => {
  res.send(botProcess ? "🟢 ONLINE" : "🔴 OFFLINE");
});

// Server
app.listen(PORT, () => {
  console.log(`🌐 Panel running on http://localhost:${PORT}`);
});
