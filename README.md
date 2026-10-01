# PhoneMail

> An asynchronous, phone-identity email and civic communications platform designed to bridge the digital divide.

Built for the **AlphaStack Buildathon**, PhoneMail maps a user's standard telephone number directly to their primary email address (e.g., `+91 9655802712` becomes `9655802712@phonemail.com`). It unites modern desktop web clients, native mobile web apps, basic feature/keypad phones (via a Two-Way SMS Bridge), and voice landlines (via Twilio Interactive Voice Response).

---

## Video Demonstration & Explanation

Watch the comprehensive video walkthrough demonstrating the application architecture, live Twilio verification, IVR voice grievance hotline, two-way SMS bridge, emergency robocall broadcast, and cryptographic receipt verification:

* **Video Walkthrough Link:** [Google Drive Demonstration Video](https://drive.google.com/file/d/1rvldUAJGQztJivGR3edzJAn90Taj3hPQ/view?usp=sharing)

---

## Executive Summary & Problem Statement

Traditional email systems require alphanumeric usernames, passwords, high-speed internet, English literacy, and modern smartphones. This excludes billions of rural, elderly, illiterate, or basic feature-phone users from formal digital communication, government notices, and civic grievance redressal.

PhoneMail solves this by transforming every phone number into an authenticated, multi-modal mailbox:
* **No Alphanumeric Handles or Passwords:** Authentication uses the physical phone itself via dual-channel Twilio verification (SMS OTP or automated Voice Call OTP with Amazon Polly).
* **Multi-Modal Inclusive Access:**
  * **Desktop / Laptop:** 3-column split view inspired by Gmail (for screens >= 768px).
  * **Smartphone:** 4-screen native mobile email workflow (for screens < 768px).
  * **Basic Keypad (2G/3G) Feature Phones:** Two-way SMS bridge enabling citizens to receive incoming email alerts and reply directly via SMS text messages without internet.
  * **Voice Landlines & Illiterate Users:** Toll-free Interactive Voice Response (IVR) helpline (`+18005550199`) where citizens dial, speak their grievance, and automated speech-to-text transcribes and delivers an audio email docket to municipal authorities.

---

## Key Features

### 1. Phone-Number Email Identity
* Accounts use normalized E.164 phone numbers as immutable IDs (`9655802712@phonemail.com`).
* Eliminates forgotten passwords, complex signups, and account duplication.

### 2. Dual-Channel Twilio Verification
* **Option 1 (SMS OTP):** Dispatches a 6-digit random code via Twilio SMS.
* **Option 2 (Voice Call OTP):** Twilio initiates an outbound phone call and speaks the 6-digit code aloud using Amazon Polly text-to-speech (`Polly.Joanna`), designed for landlines, elderly users, and visually impaired citizens.

### 3. Inbound Voice IVR Helpline & Voice Grievance Recording
* Toll-free hotline (`+18005550199`) answers with interactive TwiML IVR greetings.
* **Key 1:** Creates a PhoneMail account for the caller based on their Caller ID.
* **Key 2:** Prompts the caller to speak their problem and ward after the beep. The audio recording is captured, auto-transcribed via speech-to-text, and delivered as an email docket with an attached MP3 to the respective department inbox.
* Automatic SMS confirmation with ticket tracking number (`#TKT-YYYY-XXXX`) is dispatched to the citizen's phone.

### 4. Two-Way SMS Bridge for Keypad / Feature Phones
* When an email or official response is dispatched to a citizen, an automated SMS alert is transmitted to their mobile phone.
* Citizens can reply directly to the SMS text message (e.g., `RE #TKT-2026-8812 Fixed the leakage`).
* PhoneMail parses the docket token, threads the reply into the email conversation in real-time, and notifies officers.

### 5. Interactive Disaster Voice Robocall Blast (DTMF Key 1=Safe, Key 2=SOS)
* Civil Defense authorities can trigger emergency voice robocalls to citizens in targeted area codes.
* Citizens listen to the emergency advisory and respond via keypad:
  * **Press 1:** Status logged as SAFE in the disaster database.
  * **Press 2:** Critical SOS rescue ticket generated; emergency alert flashed to dispatch terminals; rescue teams mobilized.

### 6. Welfare Document Locker & Cryptographic Seal Verification
* Dedicated `Govt Receipts` storage for official documents (Property Tax Clearance, Driving License Renewal, Welfare Pension Slips, Power Subsidies).
* Every document contains a tamper-evident SHA-256 cryptographic seal.
* Dynamic SVG QR code generation for physical verification.
* Built-in webcam camera QR scanner powered by `jsQR` to detect counterfeit or altered documents.

### 7. Universal 11-Language Localization & Neural TTS Audio Streaming
* Full interface and content localization across 11 languages: English, Tamil, Hindi, Telugu, Kannada, Malayalam, Bengali, Marathi, Gujarati, Spanish, and French.
* Parallel neural batch translation for inbox subjects and preview snippets.
* Native text-to-speech audio streaming (`/api/emails/tts`) for illiterate citizens, pronouncing regional Indian scripts with accurate phonetics.
* Dual-mode reading pane toggle (Translated View vs. Original View).

### 8. Dual Interface Paradigms & Manual Viewport Switcher
* **Desktop View (>= 768px):** 3-column split layout with collapsible sidebar, folder navigation, unread badge counters, email list, and comprehensive reading pane.
* **Mobile View (< 768px):** 4-screen mobile workflow with search header, filter chips, compact email cards, bottom navigation bar, and slide-out drawer.
* **Manual Override Control:** Segmented toggle in the top bar allows reviewers to switch between `Auto (768px)`, `Desktop`, and `Mobile` on any device size.

### 9. Real-Time WebSocket Gateway
* Persistent WebSocket connections deliver instant push notifications for incoming emails, SMS replies, and high-priority civic broadcast banners without page refreshes.

### 10. Schema-Driven SQLite Persistence in WAL Mode
* Pure SQLite storage with Write-Ahead Logging (`PRAGMA journal_mode = WAL`) for concurrent read/write transactions.
* Dual-driver architecture: automatically uses `better-sqlite3` and falls back to Node.js native `node:sqlite` if precompiled binaries are unavailable.

---

## System Architecture

```
+---------------------------------------------------------------------------------------------------+
|                                        ACCESS CHANNELS                                            |
|   +-----------------------+     +-----------------------+     +-------------------------------+   |
|   |  Desktop Web Browser  |     |   Mobile Web Client   |     |    Physical Mobile Devices    |   |
|   | (Gmail 3-Column View) |     |  (4-Screen Flow App)  |     | (Keypad Phone / Landline IVR) |   |
|   +-----------+-----------+     +-----------+-----------+     +---------------+---------------+   |
+---------------|-----------------------------|---------------------------------|-------------------+
                |                             |                                 |
                |   HTTP / REST / Cookies     |   WebSocket (ws://)             | Twilio Voice / SMS
                |                             |   Real-Time Push                | Webhook Callbacks
                v                             v                                 v
+---------------------------------------------------------------------------------------------------+
|                                  PHONEMAIL BACKEND GATEWAY                                        |
|                                    (Node.js / Express.js)                                         |
|                                                                                                   |
|   Routers:                                                                                        |
|   - /api/auth      : OTP Request / Verify, Official Login, Account Switcher                       |
|   - /api/emails    : Send, List, Star, Read, Move, Batch Translation, Audio TTS                   |
|   - /api/twilio    : Voice IVR Incoming, Keypress, Audio Transcribe, SMS Bridge, Robocall Blast   |
|   - /api/receipts  : SHA-256 Seal Verify, SVG QR Stream, Audit Ledger                             |
|                                                                                                   |
|   Services:                                                                                       |
|   - Twilio Service : SMS Dispatch, Amazon Polly Outbound Voice, TwiML Engine                      |
|   - I18N Engine    : 11-Language Neural Translation, Audio Stream Proxy, In-Memory LRU Cache      |
|   - WebSocket Hub  : Active Connection Registry, Event Broadcast Gateway                          |
+-----------------------------------------------|---------------------------------------------------+
                                                |
                                                v
+---------------------------------------------------------------------------------------------------+
|                                     DATA PERSISTENCE LAYER                                        |
|   SQLite3 with Write-Ahead Logging (WAL)                                                          |
|   Primary Driver: better-sqlite3  |  Fallback: node:sqlite DatabaseSync                           |
|                                                                                                   |
|   Tables:                                                                                         |
|   - users              : Citizen & Officer identities, roles, departments, employee IDs           |
|   - emails             : Universal email store, folders, labels, attachments, verified flags      |
|   - otps               : Transient 6-digit codes with 5-minute TTL                                |
|   - grievance_tickets  : Structured municipal grievance dockets (#TKT-YYYY-XXXX)                 |
|   - disaster_robocalls : Outbound call state machine and DTMF response tracking                   |
+---------------------------------------------------------------------------------------------------+
```

---

## Technology Stack

* **Backend Runtime:** Node.js (v18 to v24+) with native ES Modules (`"type": "module"`).
* **Server Framework:** Express.js (v4.21.2) with CORS, Cookie-Parser, and JSON parsers.
* **Database:** SQLite3 in WAL mode (`better-sqlite3` v11.8.1 with automatic fallback to native `node:sqlite`).
* **Real-Time Communication:** WebSockets via `ws` (v8.18.0).
* **Telephony Gateway:** Twilio SDK (v5.4.3) with live cloud delivery and local mock simulation mode.
* **Voice Synthesis & TTS:** Amazon Polly (`Polly.Joanna`) via TwiML, Google Translate TTS audio streaming.
* **Frontend:** Vanilla HTML5, Vanilla JavaScript (ES6+), Tailwind CSS (v4.3.3 CLI build).
* **Computer Vision / QR Engine:** `qrcode` (v1.5.4) for SVG QR generation, `jsQR` (v1.4.0) for in-browser webcam decoding.
* **Containerization:** Multi-stage production `Dockerfile` and `docker-compose.yml`.

---

## Quick Start (with Docker)

### 1. Configure Environment
Copy the template configuration:
```bash
cp .env.example .env
```

Edit `.env` to configure your credentials or enable local mock simulation:
```env
PORT=3000
NODE_ENV=production
DB_PATH=/app/data/phonemail.sqlite
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_PHONE_NUMBER=+18005550199
MOCK_TWILIO=true
```

### 2. Launch with Docker Compose
```bash
docker compose up -d --build
```
The application will be live at `http://localhost:3000`.

---

## Local Development (without Docker)

### 1. Install Dependencies
```bash
npm install
```

### 2. Build Tailwind CSS
```bash
npm run build:css
```
For active development with auto-compilation:
```bash
npm run watch:css
```

### 3. Start Application
```bash
npm start
```
Or with auto-reloading:
```bash
npm run dev
```

Open `http://localhost:3000` in your web browser.

---

## Testing & Verification Playbook

### 1. Dual-Channel Twilio Verification
1. Navigate to `http://localhost:3000/`.
2. Enter your phone number (e.g., `+919655802712` or `+19876543210`).
3. Click **Option 1: SMS OTP** or **Option 2: Voice OTP**.
4. Enter the 6-digit code received on your phone (or view the code in the server console when running in mock mode).
5. Click **Verify & Enter Mailbox**.

### 2. Multi-Window Cross-Messaging Test
1. **Window A:** Open `http://localhost:3000/?user=%2B19876543210&layout=desktop`.
2. **Window B (Incognito):** Open `http://localhost:3000/?user=%2B19123456789&layout=desktop`.
3. In Window A, click **+ Compose**, set recipient to `+19123456789`, type a subject and message, and click **Send**.
4. Window B receives the message in real-time over WebSockets without manual refresh.

### 3. Voice IVR Grievance Hotline Simulation
Simulate a citizen calling the toll-free helpline from a non-smartphone:
```bash
curl -X POST http://localhost:3000/api/twilio/voice/simulate-helpline \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919655802712",
    "issue": "Severe drinking water pipeline contamination in Ward 14"
  }'
```
* Generates docket `#TKT-YYYY-XXXX`.
* Delivers an email with an audio recording player to the Water Board inbox.
* Sends an SMS confirmation receipt to the citizen's mobile phone.

### 4. Keypad Two-Way SMS Reply Simulation
Simulate a citizen replying to a grievance docket from their basic phone's SMS inbox:
```bash
curl -X POST http://localhost:3000/api/twilio/sms/simulate-reply \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919655802712",
    "message": "RE #TKT-2026-8812: Municipal engineer visited the site today."
  }'
```
* Automatically threads the message into the official conversation in PhoneMail.

### 5. Disaster Robocall DTMF Simulation (SOS Emergency)
Simulate a citizen receiving an automated disaster voice blast and pressing `2` for emergency evacuation:
```bash
curl -X POST http://localhost:3000/api/twilio/voice/simulate-robocall \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+919655802712",
    "digit": "2",
    "headline": "Coastal Cyclone & Storm Surge Alert"
  }'
```
* Generates a critical SOS docket.
* Fires an emergency audio advisory and visual alarm banner across all civil defense operator consoles.

### 6. Cryptographic Seal Verification
1. In the left sidebar, click `Govt Receipts`.
2. Open any official government receipt (e.g., Property Tax Assessment).
3. Inspect the cryptographic SHA-256 seal and issuing authority block.
4. Click `Verify QR Seal` in the toolbar to test the camera QR scanner or test altered payloads to observe tamper detection.

### 7. Responsive Viewport Switching
* **Auto Mode:** Resize your browser window above or below `768px` to transition between the desktop and mobile layouts.
* **Manual Override:** Click the segmented buttons `[ Auto (768px) | Desktop | Mobile ]` in the top bar to inspect either layout on any display size.

---

## REST API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/auth/otp/request` | `POST` | Request 6-digit OTP via SMS or Voice Call |
| `/api/auth/otp/verify` | `POST` | Verify OTP code and authenticate user |
| `/api/auth/official/login` | `POST` | Officer login with badge ID/phone and password |
| `/api/auth/accounts` | `GET` | List all accounts for rapid profile switching |
| `/api/auth/me` | `GET` | Get authenticated user profile |
| `/api/emails` | `GET` | Retrieve emails filtered by folder, label, or search |
| `/api/emails/send` | `POST` | Send email (auto-generates grievance docket if targeting civic body) |
| `/api/emails/reply-sms` | `POST` | Officer dispatches reply directly to citizen's mobile via SMS |
| `/api/emails/broadcast` | `POST` | Dispatch emergency broadcast to all citizens or selected area code |
| `/api/emails/translate-batch` | `POST` | Parallel batch translation of subjects and snippets |
| `/api/emails/tts` | `GET` | MPEG audio stream of text pronounced in regional languages |
| `/api/twilio/voice/incoming` | `POST` | Inbound IVR call webhook returning TwiML greeting |
| `/api/twilio/voice/keypress` | `POST` | Process IVR keypress (1=Account, 2=Record Grievance) |
| `/api/twilio/voice/grievance-recorded` | `POST` | Captures recorded voice complaint and auto-transcription |
| `/api/twilio/sms/incoming` | `POST` | Inbound SMS webhook with docket token parsing |
| `/api/twilio/voice/trigger-blast` | `POST` | Outbound disaster robocall blast to targeted area codes |
| `/api/receipts/verify` | `POST` | Validate cryptographic SHA-256 seal integrity |
| `/api/receipts/qr-svg/:emailId` | `GET` | Stream sharp vector SVG QR code for an official receipt |
| `/api/health` | `GET` | System health check, Node version, and database status |

---

## Project Structure

```
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Container configuration with persistent SQLite mount
├── .dockerignore               # Docker build exclusions
├── .env.example                # Environment variables template
├── package.json                # Project dependencies, scripts, and Tailwind configuration
├── README.md                   # Project documentation
├── APPLICATION_DOCUMENTATION.md# Exhaustive architecture manual and specifications
├── data/                       # Persistent SQLite database storage directory
│   └── phonemail.sqlite        # SQLite database (WAL mode)
├── src/
│   └── input.css               # Tailwind CSS theme tokens and layout styling
├── public/
│   ├── css/
│   │   └── style.css           # Compiled, minified Tailwind CSS bundle
│   ├── js/
│   │   ├── app.js              # Primary SPA controller, state management, and WebSocket listener
│   │   ├── i18n.js             # 11-language translation dictionaries and DOM localizer
│   │   ├── icons.js            # Inline SVG icons dictionary (zero emojis in UI)
│   │   └── vendor/
│   │       └── jsQR.js         # Client-side QR code camera scanner
│   └── index.html              # Responsive SPA shell for Desktop and Mobile views
└── server/
    ├── index.js                # Express server entry point and WebSocket gateway
    ├── config.js               # Environment configuration and validation
    ├── db.js                   # SQLite schema, migrations, and query repository
    ├── services/
    │   └── twilioService.js    # Twilio SMS, Voice OTP, Polly TwiML, and alert dispatchers
    └── routes/
        ├── auth.js             # OTP request, verify, profile switch, and officer auth
        ├── emails.js           # Send, read, star, threads, translation, and TTS streaming
        ├── twilio.js           # Voice IVR, keypress handlers, SMS bridge, and robocall blasts
        └── receipts.js         # Cryptographic seal verification and dynamic SVG QR generation
```

---

## License

This project is licensed under the MIT License.
