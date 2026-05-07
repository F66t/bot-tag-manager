module.exports = {
    // Put your bot tokens here. 
    // You can add more bots here to make scanning easier and faster.
    // The first one is the MAIN bot (needs Manage Roles). 
    tokens: [
        "YOUR_BOT_TOKEN_HERE",
        "SCANNER_TOKEN_HERE"
    ],

    // Clan identification (Use !check to find these)
    tag: "ϨⲔⲨ",
    badge: "d0b4a03d1ab77651bc3a80de29f4584a",

    // Discord IDs
    roleId: "1501492145700474890",
    targetChannelId: "1350094374704251023",

    // Timings & Delays
    scanIntervalMs: 120000,
    requestDelayMs: 650,
    roleActionDelayMs: 800,
    queueProcessorMs: 3000,
    progressEvery: 100,

    // Logic Settings
    scanOfflineMembers: true,
    emoji: "<a:vara:1471281164319719511>",
    replyOnGrant: true,
    removeRoleIfMismatch: true,

    // Advanced
    scannerCacheMs: 15000,
    defaultRateLimitSeconds: 30,
};
