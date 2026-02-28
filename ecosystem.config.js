/** PM2 configuration for BeatMind AI production deployment. */
module.exports = {
  apps: [
    {
      name: "beatmind-next",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/beatmind/beat-mind-ai",
      env: {
        PORT: 3000,
        NODE_ENV: "development",
      },
      env_production: {
        PORT: 3000,
        NODE_ENV: "production",
      },
      max_memory_restart: "512M",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/opt/beatmind/logs/next-error.log",
      out_file: "/opt/beatmind/logs/next-out.log",
      merge_logs: true,
    },
    {
      name: "beatmind-ws",
      script: "ws-server.ts",
      interpreter: "bun",
      cwd: "/opt/beatmind/beat-mind-ai",
      env: {
        WS_PORT: 3001,
        NODE_ENV: "development",
      },
      env_production: {
        WS_PORT: 8080,
        NODE_ENV: "production",
      },
      max_memory_restart: "256M",
      kill_timeout: 5000,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "/opt/beatmind/logs/ws-error.log",
      out_file: "/opt/beatmind/logs/ws-out.log",
      merge_logs: true,
    },
  ],
};
