import twilio from 'twilio';
import { config } from './config.js';

// In-memory audit trail of dispatched SMS & Voice calls (useful for testing & dev drawer)
const dispatchedLogs = [];

let twilioClient = null;

if (!config.twilio.isMock) {
  try {
    if (config.twilio.apiKey && config.twilio.apiSecret && config.twilio.accountSid) {
      twilioClient = twilio(config.twilio.apiKey, config.twilio.apiSecret, { accountSid: config.twilio.accountSid });
      console.log('[Twilio] Live Twilio client initialized via API Key & Secret in twilioClient.js');
    } else if (config.twilio.accountSid && config.twilio.authToken && config.twilio.accountSid.startsWith('AC')) {
      twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
      console.log('[Twilio] Live Twilio client initialized via Account SID & Auth Token in twilioClient.js');
    }
  } catch (err) {
    console.warn('[Twilio] Failed to initialize live client, falling back to mock mode:', err.message);
  }
}

/**
 * Option 1: Send SMS Verification Code via Twilio
 */
export async function sendVerificationSms(toPhone, code) {
  const messageBody = `[PhoneMail] Your verification code is: ${code}. Valid for 5 minutes.`;
  const record = {
    id: `sms_${Date.now()}`,
    type: 'VERIFICATION_SMS',
    to: toPhone,
    code,
    body: messageBody,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`\n📱 [MOCK TWILIO SMS] To: ${toPhone}`);
    console.log(`   Message: "${messageBody}"\n`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const res = await twilioClient.messages.create({
      body: messageBody,
      from: config.twilio.phoneNumber,
      to: toPhone
    });
    record.sid = res.sid;
    record.status = res.status;
    dispatchedLogs.unshift(record);
    console.log(`[Twilio SMS] Dispatched to ${toPhone}, SID: ${res.sid}`);
    return { success: true, mock: false, sid: res.sid };
  } catch (error) {
    console.error(`[Twilio SMS Error] Failed to send SMS to ${toPhone}:`, error.message);
    record.status = 'failed';
    record.error = error.message;
    dispatchedLogs.unshift(record);
    throw error;
  }
}

/**
 * Option 2: Send Voice Call Verification Code via Twilio (speaks code aloud)
 */
export async function sendVerificationVoiceCall(toPhone, code) {
  // Format code with spaces so Twilio TTS speaks each digit individually (e.g., "1 . 2 . 3 . 4 . 5 . 6")
  const spacedCode = code.split('').join(' . ');
  const twiml = `
    <Response>
      <Pause length="1"/>
      <Say voice="Polly.Joanna">Hello! This is PhoneMail verification. Your six-digit code is: ${spacedCode}.</Say>
      <Pause length="2"/>
      <Say voice="Polly.Joanna">Repeating your code: ${spacedCode}. Thank you, goodbye!</Say>
    </Response>
  `.trim();

  const record = {
    id: `voice_${Date.now()}`,
    type: 'VERIFICATION_VOICE_CALL',
    to: toPhone,
    code,
    twiml,
    timestamp: new Date().toISOString(),
    status: 'completed'
  };

  if (!twilioClient) {
    console.log(`\n📞 [MOCK TWILIO VOICE CALL] Outbound Call to: ${toPhone}`);
    console.log(`   Spoken TwiML: "Your code is: ${code}"\n`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: toPhone,
      from: config.twilio.phoneNumber
    });
    record.sid = call.sid;
    record.status = call.status;
    dispatchedLogs.unshift(record);
    console.log(`[Twilio Voice] Placed call to ${toPhone}, Call SID: ${call.sid}`);
    return { success: true, mock: false, sid: call.sid };
  } catch (error) {
    console.error(`[Twilio Voice Error] Failed to call ${toPhone}:`, error.message);
    record.status = 'failed';
    record.error = error.message;
    dispatchedLogs.unshift(record);
    throw error;
  }
}

/**
 * Trigger SMS Notification when an incoming email arrives
 */
export async function sendEmailNotificationSms(toPhone, senderPhone, subject) {
  const alertText = `[PhoneMail] New email received from ${senderPhone}: "${subject}". Check your inbox!`;
  const record = {
    id: `alert_${Date.now()}`,
    type: 'INCOMING_EMAIL_SMS_ALERT',
    to: toPhone,
    sender: senderPhone,
    subject,
    body: alertText,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`\n🔔 [MOCK TWILIO ALERT] SMS to: ${toPhone}`);
    console.log(`   Body: "${alertText}"\n`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const res = await twilioClient.messages.create({
      body: alertText,
      from: config.twilio.phoneNumber,
      to: toPhone
    });
    record.sid = res.sid;
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    console.error(`[Twilio Alert Error]`, err.message);
    record.status = 'failed';
    dispatchedLogs.unshift(record);
    return { success: false, error: err.message };
  }
}

/**
 * Retrieve recent Twilio logs for frontend debugging & testing panel
 */
export function getRecentTwilioDispatches() {
  return dispatchedLogs.slice(0, 30);
}
