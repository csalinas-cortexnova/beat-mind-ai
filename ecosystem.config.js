/** PM2 configuration for BeatMind AI production deployment. */
module.exports = {
  apps: [
    {
      name: "beatmind-next",
      script: "node_modules/.bin/next",
      args: "start",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
    {
      name: "beatmind-ws",
      script: "ws-server.ts",
      interpreter: "bun",
      env: {
        WS_PORT: 3001,
        NODE_ENV: "production",
      },
      max_memory_restart: "256M",
      kill_timeout: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
    },
  ],
};
