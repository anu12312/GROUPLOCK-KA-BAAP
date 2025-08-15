const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");
const HttpsProxyAgent = require("https-proxy-agent");

// Primary Indian proxy
const PRIMARY_PROXY = "http://103.119.112.54:80"; // replace if needed
const proxyAgent = new HttpsProxyAgent(PRIMARY_PROXY);

const uid = process.argv[2];
const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + "\n"); } catch {}
}

// Load appState
let appState;
try {
  const raw = fs.readFileSync(appStatePath, "utf-8");
  if (!raw.trim()) throw new Error("File is empty");
  appState = JSON.parse(raw);
} catch (err) {
  log("❌ appstate.json is invalid or empty.");
  process.exit(1);
}

// Load BOSS UID
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
  if (!BOSS_UID) throw new Error("UID missing");
} catch (err) {
  log("❌ admin.txt is invalid or empty.");
  process.exit(1);
}

let GROUP_THREAD_ID = null;
let LOCKED_GROUP_NAME = null;
let lockedNick = null;
let nickLockEnabled = false;
let nickRemoveEnabled = false;
let gcAutoRemoveEnabled = false;

// Login Options
const loginOptions = {
  appState,
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 FBAV/400.0.0.0.0",
  agent: proxyAgent,
};

function safeLogin(options) {
  login(options, async (err, api) => {
    if (err) {
      log("❌ [LOGIN FAILED]: " + err);
      return setTimeout(() => safeLogin(options), 30000); // retry after 30s
    }

    api.setOptions({
      listenEvents: true,
      selfListen: true,
      updatePresence: true,
      userAgent: options.userAgent,
      headers: {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-IN,en-US;q=0.9,en;q=0.8",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Origin": "https://www.facebook.com",
        "Referer": "https://www.facebook.com/",
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "X-FB-LSD": "AVpWNRQy_OU",
        "X-FB-Friendly-Name": "MessengerGraphQLThreadlistQuery",
        "X-FB-Revision-ID": "4000123",
      },
      agent: proxyAgent,
    });

    log("🤖 BOT ONLINE — Ready to rock");

    // Anti-sleep heartbeat
    setInterval(async () => {
      if (GROUP_THREAD_ID) {
        try {
          await api.sendTypingIndicator(GROUP_THREAD_ID, true);
          setTimeout(() => api.sendTypingIndicator(GROUP_THREAD_ID, false), 1000 + Math.random() * 1000);
          log("💤 Anti-Sleep Triggered");
        } catch {}
      }
    }, 300000);

    // Periodic appState save
    setInterval(() => {
      try {
        const newAppState = api.getAppState();
        fs.writeFileSync(appStatePath, JSON.stringify(newAppState, null, 2));
        log("💾 Appstate saved ✅");
      } catch (e) {
        log("❌ Appstate save failed: " + e);
      }
    }, 600000);

    // Listen Events
    api.listenMqtt(async (err, event) => {
      if (err) return log("❌ Listen error: " + err);

      const senderID = event.senderID;
      const threadID = event.threadID;
      const body = (event.body || "").toLowerCase();

      if (event.type === "message") log(`📩 ${senderID}: ${event.body} (Group: ${threadID})`);

      // ====== Commands Logic (unchanged) ======
      if (body.startsWith("/gclock") && senderID === BOSS_UID) {
        const newName = event.body.slice(7).trim();
        GROUP_THREAD_ID = threadID;
        LOCKED_GROUP_NAME = newName;
        gcAutoRemoveEnabled = false;
        try { await api.setTitle(newName, threadID); api.sendMessage(`🔒 Naam lock ho gaya: "${newName}"`, threadID); } catch { api.sendMessage("❌ Naam lock nahi hua", threadID); }
      }

      if (body === "/gcremove" && senderID === BOSS_UID) {
        try { await api.setTitle("", threadID); LOCKED_GROUP_NAME = null; GROUP_THREAD_ID = threadID; gcAutoRemoveEnabled = true; api.sendMessage("🧹 Naam hata diya. Auto remove ON ✅", threadID); } catch { api.sendMessage("❌ Naam remove fail", threadID); }
      }

      if (event.logMessageType === "log:thread-name") {
        const changed = event.logMessageData.name;
        if (LOCKED_GROUP_NAME && threadID === GROUP_THREAD_ID && changed !== LOCKED_GROUP_NAME) {
          try { await api.setTitle(LOCKED_GROUP_NAME, threadID); } catch { api.sendMessage("❌ GC naam wapas nahi hua", threadID); }
        } else if (gcAutoRemoveEnabled) {
          try { await api.setTitle("", threadID); log(`🧹 GC auto-removed: "${changed}"`); } catch { log("❌ GC auto remove fail"); }
        }
      }

      if (body.startsWith("/nicklock on") && senderID === BOSS_UID) {
        lockedNick = event.body.slice(13).trim();
        nickLockEnabled = true;
        try {
          const info = await api.getThreadInfo(threadID);
          for (const u of info.userInfo) await api.changeNickname(lockedNick, threadID, u.id);
          api.sendMessage(`🔐 Nickname lock: "${lockedNick}" set`, threadID);
        } catch { api.sendMessage("❌ Nickname set fail", threadID); }
      }

      if (body === "/nicklock off" && senderID === BOSS_UID) { nickLockEnabled = false; lockedNick = null; api.sendMessage("🔓 Nickname lock removed", threadID); }

      if (body === "/nickremoveall" && senderID === BOSS_UID) {
        nickRemoveEnabled = true;
        try { const info = await api.getThreadInfo(threadID); for (const u of info.userInfo) await api.changeNickname("", threadID, u.id); api.sendMessage("💥 Nicknames removed. Auto-remove ON", threadID); } catch { api.sendMessage("❌ Nick remove fail", threadID); }
      }

      if (body === "/nickremoveoff" && senderID === BOSS_UID) { nickRemoveEnabled = false; api.sendMessage("🛑 Nick auto remove OFF", threadID); }

      if (event.logMessageType === "log:user-nickname") {
        const changedUID = event.logMessageData.participant_id;
        const newNick = event.logMessageData.nickname;
        if (nickLockEnabled && newNick !== lockedNick) try { await api.changeNickname(lockedNick, threadID, changedUID); } catch { log("❌ Nick revert fail"); }
        if (nickRemoveEnabled && newNick !== "") try { await api.changeNickname("", threadID, changedUID); } catch { log("❌ Nick auto remove fail"); }
      }

      if (body === "/status" && senderID === BOSS_UID) {
        api.sendMessage(`
BOT STATUS:
• GC Lock: ${LOCKED_GROUP_NAME || "OFF"}
• GC AutoRemove: ${gcAutoRemoveEnabled ? "ON" : "OFF"}
• Nick Lock: ${nickLockEnabled ? `ON (${lockedNick})` : "OFF"}
• Nick AutoRemove: ${nickRemoveEnabled ? "ON" : "OFF"}
        `.trim(), threadID);
      }
    });
  });
}

// Auto-relogin protection
process.on("uncaughtException", (err) => { log("⚠️ Uncaught Exception: " + err); });
process.on("unhandledRejection", (err) => { log("⚠️ Unhandled Rejection: " + err); });

safeLogin(loginOptions);
