const ws3 = require("ws3-fca");
const fs = require("fs");
const path = require("path");
const HttpsProxyAgent = require("https-proxy-agent");

// Proxy setup (optional, set to null if no proxy)
const PRIMARY_PROXY = "http://103.119.112.54:80"; // update with your proxy or null
const proxyAgent = PRIMARY_PROXY ? new HttpsProxyAgent(PRIMARY_PROXY) : null;

// User-specific paths
const uid = process.argv[2];
const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");

// Load appState safely
let appState;
try {
  appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));
} catch {
  console.error("❌ appstate.json invalid or missing");
  process.exit(1);
}

// Load admin UID safely
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
} catch {
  console.error("❌ admin.txt invalid or missing");
  process.exit(1);
}

// Logging utility (append logs and console)
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + "\n"); } catch {}
}

let LOCKED_GROUPS = {};
let nickLockEnabled = false;
let lockedNick = null;

const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);

const loginOptions = {
  appState,
  userAgent: "Mozilla/5.0 (Linux; Android 10; SM-G970F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Mobile Safari/537.36 [FBAN/MessengerForAndroid;FBAV/330.0.0.42.116;]",
  agent: proxyAgent,
  headers: {
    "X-FB-Friendly-Name": "MessengerForAndroid",
  },
};

function saveAppStatePeriodically(api) {
  setInterval(() => {
    try {
      fs.writeFileSync(appStatePath, JSON.stringify(api.getAppState(), null, 2));
      log("💾 Appstate saved");
    } catch (e) {
      log("❌ Save failed: " + e.message);
    }
  }, 600000); // every 10 minutes
}

function safeLogin(options) {
  login(options, async (err, api) => {
    if (err) {
      log("❌ LOGIN FAILED: " + err);
      return setTimeout(() => safeLogin(options), 30000);
    }
    api.setOptions({ listenEvents: true, selfListen: true, updatePresence: true, agent: proxyAgent });
    log("🤖 BOT ONLINE");

    // Periodic anti-sleep typing indicator for locked groups
    setInterval(() => {
      for (const threadID in LOCKED_GROUPS) {
        (async () => {
          try {
            await api.sendTypingIndicator(threadID, true);
            setTimeout(() => api.sendTypingIndicator(threadID, false), 1000);
            log(`💤 Anti-sleep sent to ${threadID}`);
          } catch {}
        })();
      }
    }, 300000); // every 5 minutes

    saveAppStatePeriodically(api);

    api.listenMqtt(async (err, event) => {
      if (err) return log("❌ Listen error: " + err);

      const senderID = event.senderID;
      const threadID = event.threadID;
      const body = (event.body || "").toLowerCase();

      if (event.type === "message") log(`📩 ${senderID}: ${event.body} (Group:${threadID})`);

      // /gclock command to lock group name
      if (body.startsWith("/gclock") && senderID === BOSS_UID) {
        const name = event.body.slice(7).trim();
        if (!name) {
          return api.sendMessage("❌ Please provide a group name to lock.", threadID);
        }
        LOCKED_GROUPS[threadID] = { name };
        try {
          await api.setTitle(name, threadID);
          api.sendMessage(`🔒 Group name locked as "${name}"`, threadID);
          log(`Group ${threadID} locked with name "${name}"`);
        } catch (e) {
          log("❌ Lock failed: " + e);
          api.sendMessage("❌ Lock failed: " + (e.message || e), threadID);
        }
      }

      // /gcremove command to remove lock
      if (body === "/gcremove" && senderID === BOSS_UID) {
        if (!LOCKED_GROUPS[threadID]) {
          return api.sendMessage("⚠️ No lock exists for this group.", threadID);
        }
        delete LOCKED_GROUPS[threadID];
        try {
          await api.setTitle("", threadID);
          api.sendMessage("🧹 Lock removed", threadID);
          log(`Lock removed for group ${threadID}`);
        } catch (e) {
          log("❌ Remove fail: " + e);
          api.sendMessage("❌ Remove failed: " + (e.message || e), threadID);
        }
      }

      // /nicklock on command to enable nick lock
      if (body.startsWith("/nicklock on") && senderID === BOSS_UID) {
        lockedNick = event.body.slice(13).trim();
        if (!lockedNick) {
          return api.sendMessage("❌ Provide a nickname to lock.", threadID);
        }
        nickLockEnabled = true;
        try {
          const info = await api.getThreadInfo(threadID);
          for (const u of info.userInfo) {
            await api.changeNickname(lockedNick, threadID, u.id);
          }
          api.sendMessage(`🔐 Nick lock enabled with nickname "${lockedNick}"`, threadID);
          log(`Nick lock enabled with nickname "${lockedNick}" for group ${threadID}`);
        } catch (e) {
          log("❌ Nick lock failed: " + e);
          api.sendMessage("❌ Nick lock failed: " + (e.message || e), threadID);
        }
      }

      // /nicklock off command to disable nick lock
      if (body === "/nicklock off" && senderID === BOSS_UID) {
        nickLockEnabled = false;
        lockedNick = null;
        api.sendMessage("🔓 Nick lock disabled", threadID);
        log("Nick lock disabled");
      }

      // Revert nickname if changed and nick lock enabled
      if (event.logMessageType === "log:user-nickname") {
        const changedUID = event.logMessageData.participant_id;
        const newNick = event.logMessageData.nickname;
        if (nickLockEnabled && newNick !== lockedNick) {
          try {
            await api.changeNickname(lockedNick, threadID, changedUID);
            log(`Nickname reverted for user ${changedUID} in group ${threadID}`);
          } catch {
            log("❌ Nickname revert failed");
          }
        }
      }

      // /help command to list available commands
      if (body === "/help") {
        const helpMsg = `
Available Commands:
/gclock <name> - Lock group name
/gcremove - Remove group name lock
/nicklock on <nickname> - Lock nickname for all members
/nicklock off - Remove nickname lock
/status - Show bot status
/exit - Shutdown bot
/help - Show this message
        `;
        api.sendMessage(helpMsg.trim(), threadID);
      }

      // /status command to show current locks
      if (body === "/status" && senderID === BOSS_UID) {
        const gcLocks = Object.entries(LOCKED_GROUPS)
          .map(([tid, info]) => `${tid}: "${info.name}"`)
          .join("\n") || "OFF";
        api.sendMessage(
          `BOT STATUS:\n• GC Locks:\n${gcLocks}\n• Nick Lock: ${
            nickLockEnabled ? lockedNick : "OFF"
          }`,
          threadID
        );
      }

      // /exit command to shutdown bot gracefully
      if (body === "/exit" && senderID === BOSS_UID) {
        api.sendMessage("🛑 Shutting down...", threadID);
        process.exit(0);
      }
    });
  });
}

// Catch unexpected errors to prevent crashing
process.on("uncaughtException", (e) => log("⚠️ Uncaught: " + e));
process.on("unhandledRejection", (e) => log("⚠️ Rejection: " + e));

// Start the bot
safeLogin(loginOptions);
