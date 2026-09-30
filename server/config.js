import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from project root
dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  appUrl: process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`,
  dbPath: process.env.DB_PATH || path.resolve(__dirname, '../data/phonemail.sqlite'),
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    apiKey: process.env.TWILIO_API_KEY || '',
    apiSecret: process.env.TWILIO_API_SECRET || '',
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID || '',
    phoneNumber: process.env.TWILIO_PHONE_NUMBER || '+18005550199',
    isMock: process.env.MOCK_TWILIO === 'true' || !(
      (process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_AUTH_TOKEN !== '00000000000000000000000000000000') ||
      (process.env.TWILIO_ACCOUNT_SID?.startsWith('AC') && process.env.TWILIO_API_KEY?.startsWith('SK') && process.env.TWILIO_API_SECRET)
    )
  }
};

export function logConfigSummary() {
  console.log('\n=========================================');
  console.log('       PHONEMAIL SERVER CONFIG');
  console.log('=========================================');
  console.log(` Port:           ${config.port}`);
  console.log(` Environment:    ${config.nodeEnv}`);
  console.log(` Database:       ${config.dbPath}`);
  console.log(` Twilio Mode:    ${config.twilio.isMock ? 'SIMULATED (Mock Mode Enabled)' : 'LIVE (Twilio Cloud)'}`);
  console.log(` Twilio Account: ${config.twilio.accountSid ? config.twilio.accountSid.slice(0, 10) + '...' : 'Not configured'}`);
  if (config.twilio.apiKey) {
    console.log(` Twilio API Key: ${config.twilio.apiKey.slice(0, 8)}... (Authenticated via API Key)`);
  }
  console.log(` Twilio Number:  ${config.twilio.phoneNumber || 'Not configured'}`);
  console.log('=========================================\n');
}
