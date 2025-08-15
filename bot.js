const ws3 = require("ws3-fca");
const login = typeof ws3 === "function" ? ws3 : (ws3.default || ws3.login || ws3);
const fs = require("fs");
const path = require("path");
const HttpsProxyAgent = require("https-proxy-agent");

// Proxy (optional)
const PRIMARY_PROXY = "http://103.119.112.54:80";
const proxyAgent = new HttpsProxyAgent(PRIMARY_PROXY);

// User-specific paths
const uid = process.argv[2];
const userDir = path.join(__dirname, "users", uid);
const appStatePath = path.join(userDir, "appstate.json");
const adminPath = path.join(userDir, "admin.txt");
const logPath = path.join(userDir, "logs.txt");

// Logging function
function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath, line + "\n"); } catch {}
}

// Load appstate
let appState;
try {
  appState = JSON.parse(fs.readFileSync(appStatePath, "utf-8"));
} catch { log("❌ appstate.json invalid"); process.exit(1); }

// Load admin UID
let BOSS_UID;
try {
  BOSS_UID = fs.readFileSync(adminPath, "utf-8").trim();
} catch { log("❌ admin.txt invalid"); process.exit(1); }

// Locks
let LOCKED_GROUPS = {};
let lockedNick = null;
let nickLockEnabled = false;

// Login
const loginOptions = { appState, userAgent:"Mozilla/5.0", agent:proxyAgent };

function safeLogin(options) {
  login(options, async (err, api) => {
    if(err){ log("❌ LOGIN FAILED: "+err); return setTimeout(()=>safeLogin(options),30000); }

    api.setOptions({ listenEvents:true, selfListen:true, updatePresence:true, agent:proxyAgent });
    log("🤖 BOT ONLINE");

    // Anti-sleep
    setInterval(async ()=>{
      for(const threadID in LOCKED_GROUPS){
        try{ await api.sendTypingIndicator(threadID,true); setTimeout(()=>api.sendTypingIndicator(threadID,false),1000); log(`💤 Anti-sleep ${threadID}`);} catch{}
      }
    },300000);

    // Save appstate periodically
    setInterval(()=>{
      try{ fs.writeFileSync(appStatePath, JSON.stringify(api.getAppState(),null,2)); log("💾 Appstate saved"); } catch(e){ log("❌ Save failed: "+e); }
    },600000);

    // Listen events
    api.listenMqtt(async (err, event)=>{
      if(err) return log("❌ Listen error: "+err);
      const senderID = event.senderID;
      const threadID = event.threadID;
      const body = (event.body||"").toLowerCase();

      if(event.type==="message") log(`📩 ${senderID}: ${event.body} (Group:${threadID})`);

      // GC Lock
      if(body.startsWith("/gclock") && senderID===BOSS_UID){
        const name = event.body.slice(7).trim();
        LOCKED_GROUPS[threadID]={name};
        try{ await api.setTitle(name,threadID); api.sendMessage(`🔒 Name locked: "${name}"`, threadID); } catch{ api.sendMessage("❌ Lock failed", threadID); }
      }

      if(body==="/gcremove" && senderID===BOSS_UID){
        delete LOCKED_GROUPS[threadID];
        try{ await api.setTitle("",threadID); api.sendMessage("🧹 Lock removed", threadID);} catch{ api.sendMessage("❌ Remove fail", threadID); }
      }

      // Nick lock
      if(body.startsWith("/nicklock on") && senderID===BOSS_UID){
        lockedNick = event.body.slice(13).trim();
        nickLockEnabled = true;
        try{ const info = await api.getThreadInfo(threadID); for(const u of info.userInfo) await api.changeNickname(lockedNick,threadID,u.id); api.sendMessage(`🔐 Nick locked: "${lockedNick}"`,threadID);} catch{ api.sendMessage("❌ Nick failed",threadID);}
      }

      if(body==="/nicklock off" && senderID===BOSS_UID){ nickLockEnabled=false; lockedNick=null; api.sendMessage("🔓 Nick lock removed",threadID); }

      if(body==="/nickremoveall" && senderID===BOSS_UID){
        try{ const info = await api.getThreadInfo(threadID); for(const u of info.userInfo) await api.changeNickname("",threadID,u.id); api.sendMessage("💥 All nicknames removed",threadID);} catch{ api.sendMessage("❌ Remove fail",threadID);}
      }

      // Revert nickname if changed
      if(event.logMessageType==="log:user-nickname"){
        const changedUID = event.logMessageData.participant_id;
        const newNick = event.logMessageData.nickname;
        if(nickLockEnabled && newNick!==lockedNick) try{ await api.changeNickname(lockedNick,threadID,changedUID); } catch{ log("❌ Nick revert fail"); }
      }

      // Status & help commands
      if(body==="/status" && senderID===BOSS_UID){
        const gcLocks = Object.entries(LOCKED_GROUPS).map(([tid, info])=>`${tid}: "${info.name}"`).join("\n")||"OFF";
        api.sendMessage(`BOT STATUS:\n• GC Locks:\n${gcLocks}\n• Nick Lock: ${nickLockEnabled ? lockedNick : "OFF"}`,threadID);
      }

      if(body==="/help" && senderID===BOSS_UID){
        api.sendMessage("/gclock • /gcremove • /nicklock on • /nicklock off • /nickremoveall • /status • /help • /exit",threadID);
      }

      if(body==="/exit" && senderID===BOSS_UID){
        api.sendMessage("🛑 Shutting down...",threadID);
        process.exit(0);
      }
    });
  });
}

// Catch errors
process.on("uncaughtException", e=>log("⚠️ Uncaught: "+e));
process.on("unhandledRejection", e=>log("⚠️ Rejection: "+e));

safeLogin(loginOptions);
