"use strict";

module.exports = {
  apps: [
    {
      name: "pi-web",
      cwd: __dirname,
      script: "node_modules/next/dist/bin/next",
      args: "start -H 127.0.0.1 -p 30141",
      interpreter: "/root/.nvm/versions/node/v22.23.1/bin/node",
      autorestart: true,
      restart_delay: 5000,
      // pi-web always has long-lived SSE connections open (chat streams, the PWA
      // badge stream), and Next's graceful shutdown waits for them, so a SIGTERM
      // restart leaves the old server holding 30141 while pm2 respawns into a
      // permanent EADDRINUSE loop. Kill the process instead: clients reconnect
      // their streams on their own.
      kill_signal: "SIGKILL",
      kill_timeout: 5000,
      time: true,
      filter_env: ["CODEX_", "EASY_DEPLOY_"],
      env: {
        NODE_ENV: "production",
        PI_WEB_HOSTNAME: "xiaomi-ubuntu-pi.linmingji.com",
        // These three used to live only in the pm2 dump, which meant
        // `pm2 delete` + `pm2 start ecosystem.config.cjs` silently lost them.
        PI_WEB_ALLOWED_HOSTS: "xiaomi-ubuntu.taile052da.ts.net",
        PI_WEB_ALLOW_ALL_FILES: "true",
        NEXT_PUBLIC_REPLACEMENT_BASE_URL: "http://xiaomi-ubuntu.taile052da.ts.net",
        // Expanded tool arguments render as YAML. Declared here because pm2
        // restarts reuse the stored environment and Next skips its .env files
        // when __NEXT_PROCESSED_ENV is already present in that environment;
        // .env.local carries the same value for dev and clean-env starts.
        PI_WEB_TOOL_INPUT_FORMAT: "yaml",
      },
    },
  ],
};
