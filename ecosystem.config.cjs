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
      },
    },
  ],
};
