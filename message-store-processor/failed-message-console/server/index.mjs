// BFF for the Human Task UI.
//
// Responsibilities:
//   1. Authenticate users against a plain-text user store (demo only).
//   2. Hold short-lived in-memory sessions keyed by a bearer token.
//   3. Proxy /api/wf/* to the workflow management API, injecting the
//      x-user-id and x-user-roles headers the management API expects.
//
// The browser never sees or sets those headers itself — that is the whole
// point of having a backend here.

import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3001;
// Base URL of the ballerina/workflow.management service.
const MGMT_URL = process.env.MGMT_URL || "http://localhost:8234/workflow";
const USERS_FILE = process.env.USERS_FILE || path.join(__dirname, "..", "users.txt");

// ---- User store -----------------------------------------------------------

function loadUsers() {
  const text = fs.readFileSync(USERS_FILE, "utf8");
  const users = new Map();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [username, password, roles = ""] = line.split(":");
    users.set(username, {
      username,
      password,
      roles: roles.split(",").map((r) => r.trim()).filter(Boolean),
    });
  }
  return users;
}

const users = loadUsers();

// ---- Sessions (in-memory; fine for a demo) --------------------------------

const sessions = new Map(); // token -> { userId, roles }

function authMiddleware(req, res, next) {
  const header = req.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const session = token && sessions.get(token);
  if (!session) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  req.session = session;
  next();
}

// ---- App ------------------------------------------------------------------

const app = express();
app.use(express.json());

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  const user = users.get(username);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, { userId: user.username, roles: user.roles });
  res.json({ token, userId: user.username, roles: user.roles });
});

app.post("/api/logout", authMiddleware, (req, res) => {
  const header = req.get("authorization") || "";
  sessions.delete(header.slice(7));
  res.json({ ok: true });
});

app.get("/api/me", authMiddleware, (req, res) => {
  res.json(req.session);
});

// Generic, header-injecting proxy for everything under /api/wf/*.
app.all("/api/wf/*", authMiddleware, async (req, res) => {
  const subPath = req.params[0]; // everything after /api/wf/
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  const target = `${MGMT_URL}/${subPath}${qs}`;

  const headers = {
    "x-user-id": req.session.userId,
    "x-user-roles": req.session.roles.join(","),
  };
  const init = { method: req.method, headers };
  if (!["GET", "HEAD"].includes(req.method)) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(target, init);
    const text = await upstream.text();
    res.status(upstream.status);
    res.set("content-type", upstream.headers.get("content-type") || "application/json");
    res.send(text);
  } catch (err) {
    res.status(502).json({
      error: "Failed to reach workflow management API",
      detail: String(err),
      target,
    });
  }
});

app.listen(PORT, () => {
  console.log(`[bff] listening on http://localhost:${PORT}`);
  console.log(`[bff] proxying /api/wf/* -> ${MGMT_URL}`);
  console.log(`[bff] loaded ${users.size} users from ${USERS_FILE}`);
});
