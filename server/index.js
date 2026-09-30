import express from 'express';
import http from 'http';
import path from 'path';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { config, logConfigSummary } from './config.js';
import { initDatabase, getAllUsers } from './db.js';

// Route Imports
import authRouter from './routes/auth.js';
import emailsRouter from './routes/emails.js';
import twilioRouter from './routes/twilio.js';
import receiptsRouter from './routes/receipts.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite schema
initDatabase();

const app = express();
const server = http.createServer(app);

// Initialize WebSocket server attached to HTTP server
export const wss = new WebSocketServer({ server });
const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log(`[WebSocket] Client connected. Total active: ${connectedClients.size}`);

  ws.send(JSON.stringify({
    type: 'SYSTEM_CONNECTED',
    message: 'Connected to PhoneMail Real-time Gateway',
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => {
    connectedClients.delete(ws);
    console.log(`[WebSocket] Client disconnected. Total active: ${connectedClients.size}`);
  });

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('[WebSocket received]', data);
    } catch (e) {}
  });
});

/**
 * Broadcast event to all active WebSocket connections
 */
export function broadcastEvent(eventData) {
  const payload = JSON.stringify(eventData);
  for (const client of connectedClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}

// Global Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Serve static frontend assets
app.use(express.static(path.resolve(__dirname, '../public')));

// Mount API Routers
app.use('/api/auth', authRouter);
app.use('/api/emails', emailsRouter);
app.use('/api/twilio', twilioRouter);
app.use('/api/receipts', receiptsRouter);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    phase: 'Phase 3 - Backend API & Twilio Webhooks Complete',
    app: 'PhoneMail',
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
    config: {
      port: config.port,
      environment: config.nodeEnv,
      twilioMode: config.twilio.isMock ? 'mock' : 'live',
      twilioNumber: config.twilio.phoneNumber,
      dbPath: config.dbPath
    },
    websockets: {
      activeClients: connectedClients.size
    }
  });
});

// Users listing endpoint
app.get('/api/users', (req, res) => {
  res.json({ users: getAllUsers() });
});

// Fallback route for SPA
app.use((req, res) => {
  res.sendFile(path.resolve(__dirname, '../public/index.html'));
});

// Start HTTP + WS Server
server.listen(config.port, () => {
  logConfigSummary();
  console.log(`🚀 PhoneMail Phase 3 Server running on ${config.appUrl}`);
});
