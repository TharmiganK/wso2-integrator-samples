import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The frontend talks only to the BFF (server/index.mjs). The BFF authenticates
// the user and injects the x-user-id / x-user-roles headers before forwarding
// to the workflow management API.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
