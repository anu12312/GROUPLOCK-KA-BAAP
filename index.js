const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const { spawn } = require("child_process");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static("public")); // Serve frontend

// Ensure users folder exists
if (!fs.existsSync("./users")) fs.mkdirSync("./users");

// Store running bots
const runningBots = {};

// Start bot
app.post("/start-bot", (req, res) => {
  const { appstate, admin } = req.body;
  if (!appstate || !admin) return res.status(400).send("❌ AppState & UID required");

  const uidFolder = `./users/${admin}`;
  if (!fs.existsSync(uidFolder)) fs.mkdirSync(uidFolder, { recursive: true });

  // Save appstate & admin.txt
  fs.writeFileSync(`${uidFolder}/appstate.json`, appstate);
  fs.writeFileSync(`${uidFolder}/admin.txt`, admin);

  if (runningBots[admin]) return res.send("⚠️ Bot already running!");

  const botProcess = spawn("node", ["bot.js", admin], { stdio: ["pipe","pipe","pipe"] });
  runningBots[admin] = botProcess;

  // Log stdout
  botProcess.stdout.on("data", data => {
    fs.appendFileSync(`${uidFolder}/logs.txt`, data.toString());
  });
  // Log stderr
  botProcess.stderr.on("data", data => {
    fs.appendFileSync(`${uidFolder}/logs.txt`, "ERR: " + data.toString());
  });

  botProcess.on("exit", () => {
    delete runningBots[admin];
  });

  res.send("✅ Bot started successfully!");
});

// Stop bot
app.get("/stop-bot", (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).send("❌ UID required");
  if (!runningBots[uid]) return res.send("⚠️ Bot not running");
  runningBots[uid].kill();
  delete runningBots[uid];
  res.send("🛑 Bot stopped");
});

// Fetch logs
app.get("/logs", (req, res) => {
  const { uid } = req.query;
  if (!uid) return res.status(400).send("❌ UID required");
  const logPath = `./users/${uid}/logs.txt`;
  if (!fs.existsSync(logPath)) return res.send("📜 No logs yet...");
  res.send(fs.readFileSync(logPath, "utf-8"));
});

app.listen(PORT, () => console.log(`🌐 Server running on port ${PORT}`));
