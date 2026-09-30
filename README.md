# PhoneMail

> A modern email platform where a user's phone number serves as their primary email address (e.g. `9876543210@phonemail.com`).

Built for the **AlphaStack 7-Day Buildathon** with dual-channel Twilio verification (SMS and Voice Call), responsive layout engine (Gmail 3-Column Desktop & 4-Screen Mobile App), SQLite database persistence, and Docker containerization.

---

## Key Features

1. **Phone-Number Email Identity**: Accounts use normalized phone numbers as unique IDs (`9876543210@phonemail.com`).
2. **Dual-Channel Twilio Verification**:
   - **Option 1: SMS Verification**: Dispatches a 6-digit OTP code to the recipient's phone via Twilio SMS.
   - **Option 2: Voice Call Verification**: Twilio initiates an outbound call and speaks the OTP code aloud twice using Amazon Polly text-to-speech.
3. **Inbound Call IVR Registration**:
   - Callers dial the Twilio phone number, hear *"Press 1 to create your PhoneMail account"*, press `1`, and their phone number is automatically registered in SQLite via caller ID.
4. **Automated Incoming Email SMS Alerts**:
   - Whenever an email is delivered, an automated SMS alert is dispatched to the recipient's physical device via Twilio SMS.
5. **Dual Interface Paradigms (Tailwind CSS)**:
   - **Desktop Layout (`>= 768px`)**: Gmail-inspired 3-column split view with dark sidebar, compose button, custom labels (`College`, `Projects`, `Personal`, `Purchases`, `Finance`), email cards with unread blue dots, and full reading pane with key points cards and attachment download tiles.
   - **Mobile Layout (`< 768px`)**: 4-screen mail app with search, filter chips, email list, floating compose FAB, bottom navigation bar, email detail view, and slide-out navigation drawer.
   - **Manual Override Switcher**: Segmented toggle in the top bar allows reviewers to switch between `Auto (768px)`, `Desktop`, and `Mobile` on any device.
6. **Node.js SQLite Persistence**: Zero simulated data. Pure schema-driven persistence with WAL mode.
7. **Single-Command Docker Deployment**: Ready to launch with `docker compose up -d`.

---

## Quick Start (with Docker)

### 1. Configure Environment
Copy the example environment configuration:
```bash
cp .env.example .env
```
Edit `.env` to supply your Twilio credentials (or keep `MOCK_TWILIO=true` for safe local simulation with full logs):
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
docker compose up -d
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
*(Optional) Watch mode during development:*
```bash
npm run watch:css
```

### 3. Start Server
```bash
npm start
# or with auto-reload:
npm run dev
```
Open `http://localhost:3000` in your web browser.

---

## Testing & Verification Playbook

### 1. Dual-Channel Twilio Verification
- Open `http://localhost:3000/`.
- In the welcome modal, enter your phone number.
- Click **"Option 1: SMS OTP"** or **"Option 2: Voice OTP"**.
- Enter the 6-digit code and click **"Verify & Enter Mailbox"**.

### 2. Multi-Window Cross-Messaging Test
1. Open Window A: Navigate to `http://localhost:3000/?user=%2B19876543210&layout=desktop`.
2. Open Window B (Incognito): Navigate to `http://localhost:3000/?user=%2B19123456789&layout=desktop`.
3. In Window A, click **"+ Compose"**, set recipient to `+19123456789`, type a subject and message, and click **Send**.
4. Observe Window B: The new email is delivered in real-time over WebSockets without manual refresh, and an SMS alert is dispatched.

### 3. Twilio IVR Phone Call Registration
Simulate an incoming IVR phone call:
```bash
curl -X POST http://localhost:3000/api/twilio/voice/incoming \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+15559870001&CallSid=CA123"
```
Simulate pressing `1` to create an account:
```bash
curl -X POST http://localhost:3000/api/twilio/voice/keypress \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "From=+15559870001&Digits=1"
```
Verify the account was created in the database:
```bash
curl http://localhost:3000/api/users
```

### 4. Responsive Viewport Switching
- **Auto Switch**: Resize your browser window below `768px` to see the mobile view, or expand above `768px` to see the Gmail desktop view.
- **Manual Override**: Use the `[ ⚡ Auto | 💻 Desktop | 📱 Mobile ]` segmented control in the top bar to inspect any layout on any screen size.

---

## Project Structure

```
├── Dockerfile                  # Multi-stage production container build
├── docker-compose.yml          # Container configuration with persistent SQLite mount
├── .dockerignore               # Docker context exclusions
├── .env.example                # Environment variables template
├── package.json                # Project dependencies & Tailwind CLI scripts
├── README.md                   # Project documentation
├── data/                       # Persistent SQLite database storage directory
│   └── phonemail.sqlite
├── src/
│   └── input.css               # Tailwind CSS theme tokens & utility layers
├── public/
│   ├── css/
│   │   └── style.css           # Compiled Tailwind CSS bundle
│   ├── js/
│   │   └── app.js              # Client state, view router, modals & WebSocket listener
│   └── index.html              # Responsive SPA shell for Desktop & Mobile views
└── server/
    ├── index.js                # Express app entry & WebSocket gateway
    ├── config.js               # Environment loader & configuration validator
    ├── db.js                   # Node.js SQLite schema & query methods (clean WAL mode)
    ├── services/
    │   └── twilioService.js    # Twilio SMS, Voice OTP, IVR TwiML & alert dispatcher
    └── routes/
        ├── auth.js             # OTP request & verification endpoints
        ├── emails.js           # Send, read, star, threads, and folder endpoints
        └── twilio.js           # Voice IVR incoming & keypress webhooks
```
