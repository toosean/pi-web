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
      kill_timeout: 30000,
      time: true,
      filter_env: ["CODEX_", "EASY_DEPLOY_"],
      env: {
        NODE_ENV: "production",
        PI_WEB_HOSTNAME: "xiaomi-ubuntu-pi.linmingji.com",
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
