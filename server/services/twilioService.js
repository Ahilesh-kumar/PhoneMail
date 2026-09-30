import twilio from 'twilio';
import { config } from '../config.js';

// In-memory audit trail of dispatched SMS & Voice calls
const dispatchedLogs = [];

let twilioClient = null;

if (!config.twilio.isMock) {
  try {
    if (config.twilio.apiKey && config.twilio.apiSecret && config.twilio.accountSid) {
      twilioClient = twilio(config.twilio.apiKey, config.twilio.apiSecret, { accountSid: config.twilio.accountSid });
      console.log('[Twilio] Live Twilio client initialized via API Key & Secret.');
    } else if (config.twilio.accountSid && config.twilio.authToken && config.twilio.accountSid.startsWith('AC')) {
      twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
      console.log('[Twilio] Live Twilio client initialized successfully.');
    }
  } catch (err) {
    console.warn('[Twilio] Failed to initialize live client, fallback to mock:', err.message);
  }
}

let verifiedCallersCache = null;
let lastCallersFetch = 0;

export async function getVerifiedCallerIds() {
  const envList = (process.env.TWILIO_VERIFIED_NUMBERS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  if (twilioClient) {
    const now = Date.now();
    if (verifiedCallersCache && (now - lastCallersFetch) < 15000) {
      return verifiedCallersCache;
    }
    try {
      const list = await twilioClient.outgoingCallerIds.list();
      const numbers = list.map(c => c.phoneNumber);
      if (numbers.length > 0) {
        verifiedCallersCache = Array.from(new Set([...numbers, ...envList]));
        lastCallersFetch = now;
        return verifiedCallersCache;
      }
    } catch (err) {
      // Standard API key may lack outgoingCallerIds scope
    }
  }

  // Fallback to configured and verified numbers for this Twilio account
  const defaultKnown = ['+919655802712', '+919894866507'];
  verifiedCallersCache = Array.from(new Set([...defaultKnown, ...envList]));
  return verifiedCallersCache;
}

/**
 * Send 6-digit OTP code via Twilio SMS
 */
export async function sendOtpSms(toPhone, code) {
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
    console.log(`[Twilio SMS OTP] To: ${toPhone} | Message: "${messageBody}"`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  // Pre-check for Twilio Trial account restriction (Error 21608)
  const verified = await getVerifiedCallerIds();
  if (verified.length > 0 && !verified.includes(toPhone)) {
    console.warn(`[Twilio Pre-check] ${toPhone} is not verified in Twilio Trial account. Verified: ${verified.join(', ')}`);
    record.status = 'unverified_trial';
    record.error = `Number ${toPhone} is not verified in Twilio Console.`;
    record.errorCode = 21608;
    dispatchedLogs.unshift(record);
    return {
      success: false,
      mock: false,
      errorCode: 21608,
      error: `Your phone number ${toPhone} is not yet verified in your Twilio Trial account. Twilio trial accounts only allow physical SMS delivery to numbers listed under Verified Caller IDs.`,
      verifiedNumbers: verified
    };
  }

  try {
    const payload = {
      body: messageBody,
      to: toPhone
    };
    if (config.twilio.messagingServiceSid) {
      payload.messagingServiceSid = config.twilio.messagingServiceSid;
    } else {
      payload.from = config.twilio.phoneNumber;
    }
    const res = await twilioClient.messages.create(payload);
    record.sid = res.sid;
    record.status = res.status;
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (error) {
    console.warn(`[Twilio SMS Error] Outbound SMS to ${toPhone} failed: ${error.message} (Twilio Code: ${error.code})`);
    record.status = 'failed';
    record.error = error.message;
    record.errorCode = error.code;
    dispatchedLogs.unshift(record);
    return {
      success: false,
      mock: false,
      errorCode: error.code,
      error: error.message,
      sid: record.id,
      verifiedNumbers: verified
    };
  }
}

/**
 * Send 6-digit OTP code via Twilio Outbound Voice Call (speaks code aloud)
 */
export async function sendOtpVoiceCall(toPhone, code) {
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
    console.log(`[Twilio Voice OTP] Outbound Call to: ${toPhone} | Code: ${code}`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  // Pre-check for Twilio Trial account restriction
  const verified = await getVerifiedCallerIds();
  if (verified.length > 0 && !verified.includes(toPhone)) {
    console.warn(`[Twilio Voice Pre-check] ${toPhone} is not verified in Twilio Trial account.`);
    record.status = 'unverified_trial';
    record.error = `Number ${toPhone} is not verified in Twilio Console.`;
    record.errorCode = 21219;
    dispatchedLogs.unshift(record);
    return {
      success: false,
      mock: false,
      errorCode: 21219,
      error: `Your phone number ${toPhone} is not yet verified in your Twilio Trial account. Twilio trial accounts only allow physical calls to numbers listed under Verified Caller IDs.`,
      verifiedNumbers: verified
    };
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
    return { success: true, mock: false, sid: call.sid };
  } catch (error) {
    console.warn(`[Twilio Voice Error] Outbound Call to ${toPhone} failed: ${error.message} (Twilio Code: ${error.code})`);
    record.status = 'failed';
    record.error = error.message;
    record.errorCode = error.code;
    dispatchedLogs.unshift(record);
    return {
      success: false,
      mock: false,
      errorCode: error.code,
      error: error.message,
      sid: record.id,
      verifiedNumbers: verified
    };
  }
}

/**
 * Trigger SMS Notification when an incoming email arrives
 */
export async function sendIncomingEmailAlert(toPhone, senderPhone, subject) {
  const alertText = `[PhoneMail Alert] New email from ${senderPhone}: "${subject}". Check your PhoneMail inbox!`;
  const record = {
    id: `alert_${Date.now()}`,
    type: 'INCOMING_EMAIL_ALERT',
    to: toPhone,
    sender: senderPhone,
    subject,
    body: alertText,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`[Twilio Email Alert] SMS to: ${toPhone} | "${alertText}"`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const payload = { body: alertText, to: toPhone };
    if (config.twilio.messagingServiceSid) payload.messagingServiceSid = config.twilio.messagingServiceSid;
    else payload.from = config.twilio.phoneNumber;
    const res = await twilioClient.messages.create(payload);
    record.sid = res.sid;
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    console.warn(`[Twilio Email Alert Fallback] ${err.message}`);
    record.status = 'failed';
    record.error = err.message;
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, fallback: true, sid: record.id, note: err.message };
  }
}

/**
 * Trigger Civic Grievance SMS Acknowledgment to citizen
 */
export async function sendGrievanceSmsAlert(toPhone, ticketId, department, status = 'Registered') {
  const alertText = `[Civic Grievance Alert] Ticket #${ticketId} registered with ${department}. Status: ${status}. Track directly via your PhoneMail inbox.`;
  const record = {
    id: `grv_${Date.now()}`,
    type: 'GRIEVANCE_TICKET_SMS',
    to: toPhone,
    ticketId,
    department,
    body: alertText,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`[Twilio Grievance Alert] SMS to: ${toPhone} | "${alertText}"`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const payload = { body: alertText, to: toPhone };
    if (config.twilio.messagingServiceSid) payload.messagingServiceSid = config.twilio.messagingServiceSid;
    else payload.from = config.twilio.phoneNumber;
    const res = await twilioClient.messages.create(payload);
    record.sid = res.sid;
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    console.warn(`[Twilio Grievance Alert Fallback] ${err.message}`);
    record.status = 'failed';
    record.error = err.message;
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, fallback: true, sid: record.id, note: err.message };
  }
}

/**
 * Trigger Emergency Civic Broadcast SMS
 */
export async function sendEmergencyBroadcastSms(toPhone, headline, details) {
  const alertText = `[EMERGENCY CIVIC NOTICE] ${headline}: ${details}. Follow local authority guidelines.`;
  const record = {
    id: `emg_${Date.now()}`,
    type: 'EMERGENCY_BROADCAST_SMS',
    to: toPhone,
    body: alertText,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`[Twilio Emergency Alert] SMS to: ${toPhone} | "${alertText}"`);
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, sid: record.id };
  }

  try {
    const payload = { body: alertText, to: toPhone };
    if (config.twilio.messagingServiceSid) payload.messagingServiceSid = config.twilio.messagingServiceSid;
    else payload.from = config.twilio.phoneNumber;
    const res = await twilioClient.messages.create(payload);
    record.sid = res.sid;
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    console.warn(`[Twilio Emergency Alert Fallback] ${err.message}`);
    record.status = 'failed';
    record.error = err.message;
    dispatchedLogs.unshift(record);
    return { success: true, mock: true, fallback: true, sid: record.id, note: err.message };
  }
}

/**
 * Inbound IVR Voice Greeting with Option 1 (Account) & Option 2 (Grievance)
 */
export function generateIvrWelcomeTwiml(actionUrl = '/api/twilio/voice/keypress') {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: actionUrl,
    method: 'POST',
    timeout: 10
  });

  gather.say(
    { voice: 'Polly.Joanna' },
    'Welcome to the Citizen PhoneMail Helpline! Press 1 to create an account. Press 2 to record a public grievance.'
  );

  twiml.say(
    { voice: 'Polly.Joanna' },
    'We did not receive any input. Thank you for calling the Citizen PhoneMail Helpline. Goodbye!'
  );
  twiml.hangup();

  return twiml.toString();
}

/**
 * Inbound IVR Keypress Confirmation or Voice Recording Prompt
 */
export function generateIvrKeypressTwiml(digits, callerPhone = '') {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (digits === '1') {
    const spacedPhone = callerPhone.split('').join(' . ');
    twiml.say(
      { voice: 'Polly.Joanna' },
      `Congratulations! Your PhoneMail account has been created for phone number: ${spacedPhone}. You can now log in on the web portal. Thank you, goodbye!`
    );
    twiml.hangup();
  } else if (digits === '2') {
    twiml.say(
      { voice: 'Polly.Joanna' },
      'Please state your civic grievance, problem, and ward location after the beep. Press pound or hang up when finished.'
    );
    twiml.record({
      action: '/api/twilio/voice/grievance-recorded',
      transcribe: true,
      transcribeCallback: '/api/twilio/voice/transcription',
      maxLength: 120,
      finishOnKey: '#',
      playBeep: true,
      trim: 'trim-silence'
    });
  } else {
    twiml.say(
      { voice: 'Polly.Joanna' },
      'Invalid selection. Please call back and press 1 to create an account, or press 2 to record a public grievance. Goodbye!'
    );
    twiml.hangup();
  }

  return twiml.toString();
}

/**
 * Send official Department Reply to citizen's physical mobile via SMS
 */
export async function sendOfficerSmsReplyToCitizen(toPhone, ticketId, replyText, department = 'Civic Authority') {
  const messageBody = `[${department}] Re: Docket #${ticketId}: "${replyText}". You can reply directly to this SMS with "RE #${ticketId} <your reply>" to send updates.`;
  const record = {
    id: `sms_reply_${Date.now()}`,
    type: 'OFFICER_SMS_REPLY',
    to: toPhone,
    ticketId,
    department,
    body: messageBody,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`\n💬 [TWILIO OFFICER SMS REPLY] To: ${toPhone} | Docket: #${ticketId} | "${messageBody}"`);
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
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    record.status = 'failed';
    record.error = err.message;
    dispatchedLogs.unshift(record);
    return { success: false, error: err.message };
  }
}

/**
 * Send instant SMS receipt confirmation to citizen when their incoming SMS reply is processed
 */
export async function sendSmsBridgeReceiptToCitizen(toPhone, ticketId, department = 'Civic Helpline') {
  const messageBody = `[PhoneMail Confirmed] Your reply has been added to Docket #${ticketId}. The ${department} team has been notified.`;
  const record = {
    id: `sms_rcpt_${Date.now()}`,
    type: 'SMS_BRIDGE_RECEIPT',
    to: toPhone,
    ticketId,
    department,
    body: messageBody,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`\n📲 [TWILIO SMS RECEIPT ACK] To: ${toPhone} | Docket: #${ticketId}`);
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
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    record.status = 'failed';
    dispatchedLogs.unshift(record);
    return { success: false, error: err.message };
  }
}

/**
 * Generate TwiML SMS Response
 */
export function generateSmsReplyTwiml(messageBody) {
  const MessagingResponse = twilio.twiml.MessagingResponse;
  const twiml = new MessagingResponse();
  twiml.message(messageBody);
  return twiml.toString();
}

/**
 * Trigger Outbound Disaster Robocall to citizen physical phone
 */
export async function triggerDisasterRobocall(toPhone, headline, details, areaCode = 'ALL', callbackUrl = '') {
  const callId = `call_robocall_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const record = {
    id: callId,
    type: 'DISASTER_ROBOCALL_BLAST',
    to: toPhone,
    headline,
    details,
    areaCode,
    timestamp: new Date().toISOString(),
    status: 'initiated'
  };

  if (!twilioClient) {
    console.log(`\n📞 [TWILIO DISASTER ROBOCALL BLAST (SIMULATED)]`);
    console.log(`   Citizen Mobile: ${toPhone}`);
    console.log(`   Emergency Alert: "${headline}"`);
    console.log(`   Details: "${details}"`);
    console.log(`   Area Code: ${areaCode}`);
    dispatchedLogs.unshift(record);
    return {
      success: true,
      mock: true,
      call_id: callId,
      status: 'initiated',
      message: `Simulated outbound robocall placed to ${toPhone}`
    };
  }

  try {
    const call = await twilioClient.calls.create({
      url: callbackUrl,
      to: toPhone,
      from: config.twilio.phoneNumber,
      method: 'POST'
    });
    record.sid = call.sid;
    record.status = call.status;
    dispatchedLogs.unshift(record);
    return {
      success: true,
      mock: false,
      call_id: call.sid,
      status: call.status
    };
  } catch (err) {
    record.status = 'failed';
    record.error = err.message;
    dispatchedLogs.unshift(record);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Generate TwiML for Outbound Disaster Robocall with DTMF Gather
 */
export function generateDisasterRobocallTwiml(headline, details, actionUrl) {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: actionUrl,
    method: 'POST',
    timeout: 8
  });

  gather.say(
    { voice: 'Polly.Joanna' },
    `URGENT DISASTER ADVISORY from Civil Defense and Emergency Authority. Headline: ${headline}. Details: ${details}. Please listen carefully. Press 1 on your phone keypad if you are safe at your location. Press 2 immediately if you are trapped, injured, or require emergency evacuation and rescue.`
  );

  twiml.say(
    { voice: 'Polly.Joanna' },
    'We did not detect any keypad input. Please remain tuned to official radio or PhoneMail alerts for updates. Goodbye.'
  );
  twiml.hangup();

  return twiml.toString();
}

/**
 * Generate Follow-up TwiML when citizen presses 1 (Safe) or 2 (SOS Rescue)
 */
export function generateRobocallDTMFResponseTwiml(digits, callerPhone = '') {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();

  if (digits === '1') {
    twiml.say(
      { voice: 'Polly.Joanna' },
      'Thank you. Your status has been officially logged as SAFE in the Civil Defense disaster registry. Stay vigilant and remain indoors until the all-clear advisory is issued. Goodbye.'
    );
    twiml.hangup();
  } else if (digits === '2') {
    twiml.say(
      { voice: 'Polly.Joanna' },
      'EMERGENCY ALERT REGISTERED. Search and rescue coordinators have received your critical SOS request with your mobile phone coordinates. Rescue units are being dispatched to your area. Please stay calm, remain on high ground or upper floors, and keep this phone accessible. Goodbye.'
    );
    twiml.hangup();
  } else {
    twiml.say(
      { voice: 'Polly.Joanna' },
      'Unrecognized selection. If you require emergency rescue, please dial 9 1 1 or re-contact the PhoneMail Civic Helpline at 1 800 555 0199. Goodbye.'
    );
    twiml.hangup();
  }

  return twiml.toString();
}

/**
 * Send Priority Twilio SMS confirmation when SOS is triggered via Robocall
 */
export async function sendDisasterSosSmsAlert(toPhone, ticketId, headline) {
  const messageBody = `[CIVIL DEFENSE SOS CONFIRMED] Rescue dispatch docket #${ticketId} created for your location regarding "${headline}". Search & rescue teams alerted. Emergency Helpline: +18005550199. Stay on high ground.`;
  const record = {
    id: `sms_sos_${Date.now()}`,
    type: 'SOS_RESCUE_SMS_DISPATCH',
    to: toPhone,
    ticketId,
    body: messageBody,
    timestamp: new Date().toISOString(),
    status: 'delivered'
  };

  if (!twilioClient) {
    console.log(`\n🚨 [TWILIO SOS RESCUE SMS CONFIRMATION] To: ${toPhone} | Docket: #${ticketId}`);
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
    dispatchedLogs.unshift(record);
    return { success: true, mock: false, sid: res.sid };
  } catch (err) {
    record.status = 'failed';
    dispatchedLogs.unshift(record);
    return { success: false, error: err.message };
  }
}

export function getRecentDispatches() {
  return dispatchedLogs.slice(0, 50);
}
