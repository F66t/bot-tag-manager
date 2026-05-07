var config = require("./config");
var { Client, GatewayIntentBits, Partials } = require("discord.js");

var BOT_TOKENS = config.tokens.filter(t => t && t.length > 50);

if (BOT_TOKENS.length === 0) {
    console.error("[!] No tokens found in config.js");
    process.exit(1);
}

var MAIN_BOT_TOKEN = BOT_TOKENS[0];
var SCANNER_BOTS = BOT_TOKENS.slice(1);

console.log(`[*] Loaded ${BOT_TOKENS.length} bots`);

var isScanning = false;
var isProcessingQueue = false;
var roleQueue = [];
var roleQueueKeys = new Set();

var allResults = {
    checked: 0,
    queued: 0,
    added: 0,
    removed: 0,
    skipped: 0,
    failed: 0
};

function sleep(ms) {
    return new Promise(res => setTimeout(res, ms));
}

function normalizeTag(t) { return String(t || "").trim().toUpperCase(); }
function normalizeBadge(b) { return String(b || "").trim().toLowerCase(); }

function checkExactClan(userData) {
    var source = userData?.primary_guild || userData?.clan || {};
    var userTag = normalizeTag(source.tag);
    var userBadge = normalizeBadge(source.badge);
    var targetTag = normalizeTag(config.tag);
    var targetBadge = normalizeBadge(config.badge);

    var identityEnabled = source.identity_enabled === undefined || source.identity_enabled === null 
        ? true 
        : Boolean(source.identity_enabled);

    var valid = identityEnabled && userTag === targetTag && userBadge === targetBadge;

    return {
        valid: valid,
        userTag: userTag || "none",
        userBadge: userBadge || "none",
        source: userData?.primary_guild ? "primary_guild" : userData?.clan ? "clan" : "none"
    };
}

function queueRoleAction(member, reason, guild, remove = false) {
    var key = `${remove ? "rm" : "add"}:${member.id}`;
    if (roleQueueKeys.has(key)) return false;

    roleQueueKeys.add(key);
    roleQueue.push({ key, member, reason, guild, remove });
    allResults.queued++;
    return true;
}

async function fetchUser(token, userId, cache = null, bypassCache = false) {
    if (cache && !bypassCache) {
        var cached = cache.get(userId);
        if (cached && cached.exp > Date.now()) return cached.data;
    }

    var url = `https://discord.com/api/v10/users/${userId}`;
    for (var i = 0; i < 3; i++) {
        try {
            var res = await fetch(url, { headers: { Authorization: `Bot ${token}` } });
            if (res.status === 200) {
                var data = await res.json();
                if (cache) cache.set(userId, { data, exp: Date.now() + config.scannerCacheMs });
                return data;
            }
            if (res.status === 429) {
                var wait = Number(res.headers.get("retry-after")) || config.defaultRateLimitSeconds;
                console.log(`[!] Rate limited. Waiting ${wait}s...`);
                await sleep(wait * 1000);
                continue;
            }
            return null;
        } catch (e) { await sleep(1000 * (i + 1)); }
    }
    return null;
}

async function processQueue(client) {
    if (isProcessingQueue || !client?.isReady() || roleQueue.length === 0) return;
    isProcessingQueue = true;

    while (roleQueue.length > 0) {
        var item = roleQueue.shift();
        var { key, member, reason, guild, remove } = item;

        try {
            var role = guild.roles.cache.get(config.roleId);
            var me = guild.members.me;

            if (!role || !me.permissions.has("ManageRoles") || role.position >= me.roles.highest.position) {
                allResults.failed++;
                roleQueueKeys.delete(key);
                continue;
            }

            var fresh = await guild.members.fetch(member.id).catch(() => null);
            if (!fresh) {
                allResults.failed++;
                roleQueueKeys.delete(key);
                continue;
            }

            if (remove) {
                var data = await fetchUser(MAIN_BOT_TOKEN, fresh.id, null, true);
                if (data && checkExactClan(data).valid) {
                    allResults.skipped++;
                    roleQueueKeys.delete(key);
                    continue;
                }
                if (fresh.roles.cache.has(config.roleId)) {
                    await fresh.roles.remove(role, reason);
                    console.log(`[-] Removed role from ${fresh.user.tag}`);
                    allResults.removed++;
                }
            } else {
                if (!fresh.roles.cache.has(config.roleId)) {
                    await fresh.roles.add(role, reason);
                    console.log(`[+] Added role to ${fresh.user.tag}`);
                    allResults.added++;
                }
            }
        } catch (e) { allResults.failed++; }
        roleQueueKeys.delete(key);
        await sleep(config.roleActionDelayMs);
    }
    isProcessingQueue = false;
}

class Scanner {
    constructor(token, id) {
        this.token = token;
        this.id = id;
        this.cache = new Map();
        this.client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers], partials: [Partials.GuildMember] });
    }
    async start() {
        return new Promise(res => {
            this.client.once("ready", () => {
                console.log(`[Scanner ${this.id}] Ready: ${this.client.user.tag}`);
                res();
            });
            this.client.login(this.token).catch(() => res());
        });
    }
}

class Main {
    constructor(token) {
        this.token = token;
        this.cache = new Map();
        this.client = new Client({
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
            partials: [Partials.GuildMember, Partials.Message, Partials.Channel]
        });
    }
    async start() {
        this.client.on("messageCreate", async (msg) => {
            if (msg.author.bot || !msg.guild) return;

            if (msg.content.startsWith("!check")) {
                if (!msg.member.permissions.has("Administrator")) return;
                
                var id = msg.content.split(" ")[1]?.replace(/[<@!>]/g, "") || msg.author.id;
                var data = await fetchUser(this.token, id, null, true);
                if (!data) return msg.reply("User not found.");
                
                var check = checkExactClan(data);
                return msg.reply("```json\n" + JSON.stringify({ id: data.id, tag: check.userTag, badge: check.userBadge, valid: check.valid, raw: data.clan || data.primary_guild }, null, 2) + "\n```");
            }

            if (msg.channel.id !== config.targetChannelId) return;
            var member = msg.member;
            if (!member || member.roles.cache.has(config.roleId)) return;

            var data = await fetchUser(this.token, member.id, null, true);
            if (data && checkExactClan(data).valid) {
                var role = msg.guild.roles.cache.get(config.roleId);
                if (role) {
                    await member.roles.add(role, "Clan tag match");
                    console.log(`[+] Manual grant: ${member.user.tag}`);
                    if (config.replyOnGrant) msg.reply(`${config.emoji} You've received the role!`).catch(() => {});
                }
            }
        });

        return new Promise(res => {
            this.client.once("ready", () => {
                console.log(`[Main] Ready: ${this.client.user.tag}`);
                res();
            });
            this.client.login(this.token).catch(() => res());
        });
    }
}

async function run() {
    var mainBot = new Main(MAIN_BOT_TOKEN);
    await mainBot.start();

    var scanners = [];
    for (var i = 0; i < SCANNER_BOTS.length; i++) {
        var s = new Scanner(SCANNER_BOTS[i], i + 1);
        await s.start();
        scanners.push(s);
        await sleep(1500);
    }

    var guild = mainBot.client.guilds.cache.first();
    if (!guild) return console.log("No guild found.");

    setInterval(() => processQueue(mainBot.client), config.queueProcessorMs);

    var doScan = async () => {
        if (isScanning || scanners.length === 0) return;
        isScanning = true;
        console.log("\n[*] Starting periodic scan...");

        try {
            await guild.members.fetch({ force: true });
            var members = [...guild.members.cache.values()].filter(m => !m.user.bot);
            
            if (!config.scanOfflineMembers) {
                members = members.filter(m => m.presence && m.presence.status !== "offline");
            }

            var currentScanner = 0;

            for (var i = 0; i < members.length; i++) {
                var m = members[i];
                var scanner = scanners[currentScanner];
                
                var data = await fetchUser(scanner.token, m.id, scanner.cache);
                if (data) {
                    var check = checkExactClan(data);
                    var hasRole = m.roles.cache.has(config.roleId);

                    if (check.valid && !hasRole) {
                        queueRoleAction(m, "Clan match", guild, false);
                    } else if (!check.valid && hasRole && config.removeRoleIfMismatch) {
                        queueRoleAction(m, "Clan mismatch", guild, true);
                    }
                }

                if (i % config.progressEvery === 0) console.log(`[*] Progress: ${i}/${members.length}`);
                currentScanner = (currentScanner + 1) % scanners.length;
                await sleep(config.requestDelayMs);
            }
            
            console.log("[*] Scan finished.");
        } catch (e) { console.log(`[!] Scan error: ${e.message}`); }
        isScanning = false;
    };

    setInterval(doScan, config.scanIntervalMs);
    doScan();
}

run();