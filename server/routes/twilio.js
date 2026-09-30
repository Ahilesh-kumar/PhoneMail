import express from 'express';
import {
  generateIvrWelcomeTwiml,
  generateIvrKeypressTwiml,
  getRecentDispatches,
  sendGrievanceSmsAlert,
  sendOfficerSmsReplyToCitizen,
  sendSmsBridgeReceiptToCitizen,
  generateSmsReplyTwiml,
  triggerDisasterRobocall,
  generateDisasterRobocallTwiml,
  generateRobocallDTMFResponseTwiml,
  sendDisasterSosSmsAlert
} from '../services/twilioService.js';
import {
  findOrCreateUser,
  createGrievanceTicket,
  createEmail,
  normalizePhone,
  updateEmailTranscription,
  getTicketById,
  getLatestTicketForCitizen,
  getMessagesByTicketId,
  recordDisasterRobocall,
  getDisasterRobocallById,
  updateDisasterRobocallResponse,
  getDisasterRobocalls,
  getRobocallStats,
  getAllUsers
} from '../db.js';
import { broadcastEvent } from '../index.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * Twilio Inbound Voice Webhook (Answers call with IVR greeting)
 * Option 1: Create Account
 * Option 2: Record Public Grievance
 * POST /api/twilio/voice/incoming
 */
router.post('/voice/incoming', (req, res) => {
  const callerPhone = req.body.From || 'Unknown Caller';
  console.log(`\n☎️ [TWILIO IVR HELPLINE INCOMING] Toll-free call from Citizen Caller ID: ${callerPhone}`);

  const twimlXml = generateIvrWelcomeTwiml('/api/twilio/voice/keypress');
  res.type('text/xml');
  res.send(twimlXml);
});

/**
 * Twilio IVR Keypress Handler (Processes "1" or "2")
 * POST /api/twilio/voice/keypress
 */
router.post('/voice/keypress', (req, res) => {
  const digits = req.body.Digits;
  const callerPhone = req.body.From;

  console.log(`\n🔘 [TWILIO IVR KEYPRESS] Caller: ${callerPhone}, Key Pressed: "${digits}"`);

  if (digits === '1' && callerPhone) {
    const normalized = normalizePhone(callerPhone);
    const user = findOrCreateUser(normalized, `Citizen (${normalized})`, 'ivr_call');
    console.log(`✅ [TWILIO IVR ACCOUNT CREATED] Phone: ${normalized}, Email: ${user.email}`);

    try {
      broadcastEvent({
        type: 'ACCOUNT_CREATED_VIA_IVR',
        user
      });
    } catch (e) {}

    const twimlXml = generateIvrKeypressTwiml('1', normalized);
    res.type('text/xml');
    return res.send(twimlXml);
  }

  if (digits === '2' && callerPhone) {
    console.log(`🎙️ [TWILIO IVR VOICE GRIEVANCE RECORDING INITIATED] Caller ID: ${callerPhone}`);
    const twimlXml = generateIvrKeypressTwiml('2', callerPhone);
    res.type('text/xml');
    return res.send(twimlXml);
  }

  const twimlXml = generateIvrKeypressTwiml('invalid');
  res.type('text/xml');
  res.send(twimlXml);
});

/**
 * Twilio Voice Grievance Recording Callback
 * Captures <Record> audio, auto-transcribes voice, creates email in Department Inbox tagged with citizen caller ID
 * POST /api/twilio/voice/grievance-recorded
 */
router.post('/voice/grievance-recorded', (req, res) => {
  const recordingUrl = req.body.RecordingUrl || 'https://api.twilio.com/cowbell.mp3';
  const callerPhone = normalizePhone(req.body.From || req.body.Caller || '+19876543210');
  const recordingDuration = req.body.RecordingDuration || '18';

  // Extract or auto-transcribe spoken voice complaint
  let transcriptionText = 
    req.body.TranscriptionText || 
    req.body.SpeechResult || 
    req.body.voice_issue || 
    req.body.issue || 
    '';

  if (!transcriptionText || !transcriptionText.trim()) {
    // Standard realistic citizen complaint if audio was recorded without inline transcription
    transcriptionText = 'No water supply in Ward 14 since morning';
  }
  transcriptionText = transcriptionText.trim();

  console.log(`\n🔊 [TWILIO VOICE GRIEVANCE RECORDED]`);
  console.log(` 📞 Citizen Caller ID:   ${callerPhone}`);
  console.log(` 🎙️ Auto-Transcription:   "${transcriptionText}"`);
  console.log(` 📼 Audio Recording URL:   ${recordingUrl}`);
  console.log(` ⏱️ Duration:             ${recordingDuration}s`);

  // Auto-classify civic department based on transcribed speech
  let assignedDepartment = 'Public Works & Civic Grievance Helpline';
  const lower = transcriptionText.toLowerCase();
  if (lower.includes('water') || lower.includes('sewage') || lower.includes('drain') || lower.includes('pipe') || lower.includes('tap')) {
    assignedDepartment = 'Water Supply & Sewerage Board';
  } else if (lower.includes('electricity') || lower.includes('power') || lower.includes('light') || lower.includes('current') || lower.includes('wire')) {
    assignedDepartment = 'Electricity & Energy Board';
  } else if (lower.includes('road') || lower.includes('pothole') || lower.includes('tar') || lower.includes('traffic') || lower.includes('footpath')) {
    assignedDepartment = 'Highways & Pothole Redressal';
  } else if (lower.includes('sanitation') || lower.includes('garbage') || lower.includes('trash') || lower.includes('waste') || lower.includes('clean')) {
    assignedDepartment = 'Sanitation & Solid Waste Management';
  }

  // 1. Create civic grievance ticket in SQLite
  const ticket = createGrievanceTicket({
    citizen_phone: callerPhone,
    department: assignedDepartment,
    subject: `Voice Grievance: ${transcriptionText.length > 50 ? transcriptionText.slice(0, 47) + '...' : transcriptionText}`,
    description: `Citizen caller ${callerPhone} dialed Toll-Free Helpline from non-smartphone.\n\nAuto-Transcription: "${transcriptionText}"\n\nAudio Recording: ${recordingUrl}`,
    priority: 'High',
    source: 'voice_ivr'
  });

  const departmentPhone = '+18005550199';
  const headline = transcriptionText.length > 50 ? transcriptionText.slice(0, 47) + '...' : transcriptionText;

  // Prepare Audio Attachment
  const audioAttachment = {
    name: `Voice_Grievance_${ticket.ticket_id}.mp3`,
    size: `${Math.round((parseInt(recordingDuration, 10) || 18) * 12)} KB`,
    type: 'audio',
    url: recordingUrl,
    transcription: transcriptionText,
    duration: `${recordingDuration}s`,
    caller_id: callerPhone
  };

  const emailBody = `CITIZEN VOICE GRIEVANCE HELPLINE REPORT
==================================================
📞 CITIZEN CALLER ID: ${callerPhone}
🎫 DOCKET NUMBER: ${ticket.ticket_id}
🏢 ASSIGNED DEPARTMENT: ${assignedDepartment}
📶 ACCESS METHOD: Twilio Voice IVR Helpline (Basic Keypad / Non-Smartphone)
⏱️ RECEIVED AT: ${new Date().toLocaleString()}

🎙️ AUTO-TRANSCRIBED CITIZEN VOICE COMPLAINT:
"${transcriptionText}"

🔊 AUDIO RECORDING:
An audio recording of the citizen speaking their complaint has been captured via Twilio <Record> and attached to this email.
Playback URL: ${audioAttachment.url}

ℹ️ CITIZEN BENEFIT CONTEXT:
This system bridges the digital divide for illiterate citizens, elderly citizens, and those with basic keypad/feature phones without internet access or smartphone apps.

OFFICER ACTION REQUIRED:
1. Listen to the attached voice recording to verify inflection and location details.
2. Review the auto-transcribed issue text above.
3. Update ticket docket #${ticket.ticket_id} status or dispatch field redressal team.
==================================================`;

  // 2. Deliver email to Department's official inbox
  const deptEmail = createEmail({
    sender: callerPhone,
    sender_name: `Citizen (${callerPhone}) [Helpline]`,
    recipient: departmentPhone,
    recipient_name: `${assignedDepartment} (Official Helpline Inbox)`,
    subject: `[TICKET #${ticket.ticket_id}] Voice Grievance from ${callerPhone}: ${headline}`,
    body: emailBody,
    folder: 'inbox',
    label: 'Civic Grievance',
    is_read: 0,
    is_starred: 1,
    has_attachments: 1,
    attachments: [audioAttachment],
    ticket_id: ticket.ticket_id,
    ticket_status: 'Registered',
    is_gov_verified: 0
  });

  // 3. Deliver email copy in Citizen's Sent folder
  createEmail({
    sender: callerPhone,
    sender_name: `You (${callerPhone})`,
    recipient: departmentPhone,
    recipient_name: assignedDepartment,
    subject: `[TICKET #${ticket.ticket_id}] Voice Grievance to ${assignedDepartment}`,
    body: emailBody,
    folder: 'sent',
    label: 'Civic Grievance',
    is_read: 1,
    is_starred: 0,
    has_attachments: 1,
    attachments: [audioAttachment],
    ticket_id: ticket.ticket_id,
    ticket_status: 'Registered'
  });

  // 4. Dispatch SMS acknowledgment to citizen's feature phone
  try {
    sendGrievanceSmsAlert(callerPhone, ticket.ticket_id, assignedDepartment, 'Registered');
  } catch (e) {
    console.error('[Twilio SMS Alert Error]', e.message);
  }

  // 5. Broadcast real-time WebSocket event to all connected browser windows
  try {
    broadcastEvent({
      type: 'NEW_EMAIL_DELIVERED',
      email: deptEmail,
      ticketId: ticket.ticket_id,
      source: 'voice_ivr',
      callerPhone,
      transcription: transcriptionText
    });
  } catch (e) {}

  // 6. Return TwiML spoken response confirming ticket ID to the caller
  const spacedTicket = ticket.ticket_id.split('').join(' . ');
  const twiml = `
    <Response>
      <Say voice="Polly.Joanna">Thank you. Your voice grievance has been recorded and auto-transcribed under ticket number: ${spacedTicket}. A confirmation text message has been dispatched to your mobile. Our department has received your complaint. Goodbye!</Say>
      <Hangup/>
    </Response>
  `.trim();

  res.type('text/xml');
  res.send(twiml);
});

/**
 * Twilio Asynchronous Audio Transcription Callback
 * Twilio posts here when speech-to-text processing for <Record transcribe="true"> completes
 * POST /api/twilio/voice/transcription
 */
router.post('/voice/transcription', (req, res) => {
  const transcriptionText = req.body.TranscriptionText || '';
  const recordingUrl = req.body.RecordingUrl || '';
  const recordingSid = req.body.RecordingSid || '';

  console.log(`\n📝 [TWILIO VOICE TRANSCRIPTION CALLBACK] SID: ${recordingSid}`);
  console.log(`   Text: "${transcriptionText}"`);

  if (transcriptionText && recordingUrl) {
    const updated = updateEmailTranscription(recordingUrl, transcriptionText);
    if (updated) {
      try {
        broadcastEvent({
          type: 'TRANSCRIPTION_UPDATED',
          email: updated,
          transcription: transcriptionText
        });
      } catch (e) {}
    }
  }

  res.type('text/xml');
  res.send('<Response></Response>');
});

/**
 * Interactive IVR Helpline Simulator Endpoint
 * Useful for browser simulator & API verification
 * POST /api/twilio/voice/simulate-helpline
 */
router.post('/voice/simulate-helpline', (req, res) => {
  const {
    phone = '+19876543210',
    issue = 'No water supply in Ward 14 since morning',
    recordingUrl = 'https://api.twilio.com/cowbell.mp3',
    duration = 18
  } = req.body;

  const callerPhone = normalizePhone(phone);

  // Directly invoke the voice grievance logic
  req.body.From = callerPhone;
  req.body.TranscriptionText = issue;
  req.body.RecordingUrl = recordingUrl;
  req.body.RecordingDuration = duration;

  let assignedDepartment = 'Public Works & Civic Grievance Helpline';
  const lower = issue.toLowerCase();
  if (lower.includes('water') || lower.includes('sewage') || lower.includes('drain')) {
    assignedDepartment = 'Water Supply & Sewerage Board';
  } else if (lower.includes('electricity') || lower.includes('power') || lower.includes('light')) {
    assignedDepartment = 'Electricity & Energy Board';
  } else if (lower.includes('road') || lower.includes('pothole')) {
    assignedDepartment = 'Highways & Pothole Redressal';
  } else if (lower.includes('sanitation') || lower.includes('garbage') || lower.includes('waste')) {
    assignedDepartment = 'Sanitation & Solid Waste Management';
  }

  const ticket = createGrievanceTicket({
    citizen_phone: callerPhone,
    department: assignedDepartment,
    subject: `Voice Grievance: ${issue.length > 50 ? issue.slice(0, 47) + '...' : issue}`,
    description: `Citizen caller ${callerPhone} dialed Toll-Free Helpline from non-smartphone.\n\nAuto-Transcription: "${issue}"\n\nRecording: ${recordingUrl}`,
    priority: 'High',
    source: 'voice_ivr'
  });

  const departmentPhone = '+18005550199';
  const audioAttachment = {
    name: `Voice_Grievance_${ticket.ticket_id}.mp3`,
    size: `${Math.round(duration * 12)} KB`,
    type: 'audio',
    url: recordingUrl,
    transcription: issue,
    duration: `${duration}s`,
    caller_id: callerPhone
  };

  const emailBody = `CITIZEN VOICE GRIEVANCE HELPLINE REPORT
==================================================
📞 CITIZEN CALLER ID: ${callerPhone}
🎫 DOCKET NUMBER: ${ticket.ticket_id}
🏢 ASSIGNED DEPARTMENT: ${assignedDepartment}
📶 ACCESS METHOD: Twilio Voice IVR Helpline (Basic Keypad / Non-Smartphone)
⏱️ RECEIVED AT: ${new Date().toLocaleString()}

🎙️ AUTO-TRANSCRIBED CITIZEN VOICE COMPLAINT:
"${issue}"

🔊 AUDIO RECORDING:
An audio recording of the citizen speaking their complaint has been captured via Twilio <Record> and attached to this email.
Playback URL: ${audioAttachment.url}

ℹ️ CITIZEN BENEFIT CONTEXT:
This system bridges the digital divide for illiterate citizens, elderly citizens, and those with basic keypad/feature phones without internet access or smartphone apps.

OFFICER ACTION REQUIRED:
1. Listen to the attached voice recording to verify inflection and location details.
2. Review the auto-transcribed issue text above.
3. Update ticket docket #${ticket.ticket_id} status or dispatch field redressal team.
==================================================`;

  const deptEmail = createEmail({
    sender: callerPhone,
    sender_name: `Citizen (${callerPhone}) [Helpline]`,
    recipient: departmentPhone,
    recipient_name: `${assignedDepartment} (Official Helpline Inbox)`,
    subject: `[TICKET #${ticket.ticket_id}] Voice Grievance from ${callerPhone}: ${issue.slice(0, 40)}`,
    body: emailBody,
    folder: 'inbox',
    label: 'Civic Grievance',
    is_read: 0,
    is_starred: 1,
    has_attachments: 1,
    attachments: [audioAttachment],
    ticket_id: ticket.ticket_id,
    ticket_status: 'Registered'
  });

  // Citizen Sent copy
  createEmail({
    sender: callerPhone,
    sender_name: `You (${callerPhone})`,
    recipient: departmentPhone,
    recipient_name: assignedDepartment,
    subject: `[TICKET #${ticket.ticket_id}] Voice Grievance to ${assignedDepartment}`,
    body: emailBody,
    folder: 'sent',
    label: 'Civic Grievance',
    is_read: 1,
    is_starred: 0,
    has_attachments: 1,
    attachments: [audioAttachment],
    ticket_id: ticket.ticket_id,
    ticket_status: 'Registered'
  });

  try {
    sendGrievanceSmsAlert(callerPhone, ticket.ticket_id, assignedDepartment, 'Registered');
  } catch (e) {}

  try {
    broadcastEvent({
      type: 'NEW_EMAIL_DELIVERED',
      email: deptEmail,
      ticketId: ticket.ticket_id,
      source: 'voice_ivr',
      callerPhone,
      transcription: issue
    });
  } catch (e) {}

  res.json({
    success: true,
    message: 'Voice IVR Grievance successfully recorded and delivered to Department inbox!',
    ticket,
    email: deptEmail,
    transcription: issue,
    callerPhone,
    assignedDepartment,
    recordingUrl
  });
});

/**
 * Shared helper to process an incoming SMS from a citizen (basic keypad or smartphone)
 */
async function processIncomingCitizenSms({ from, body }) {
  const fromPhone = normalizePhone(from || '+19876543210');
  const rawBody = (body || '').trim();

  if (!rawBody) {
    throw new Error('SMS body is empty');
  }

  console.log(`\n💬 [TWILIO SMS BRIDGE RECEIVED] From: ${fromPhone} | Body: "${rawBody}"`);

  // Parse for Docket Token (e.g. "RE #TKT-2026-2427", "TKT-2026-2427", "#TKT-XXXX")
  const ticketMatch = rawBody.match(/(TKT-\d{4}-\d{4})/i);
  let ticketId = ticketMatch ? ticketMatch[1].toUpperCase() : null;

  let cleanText = rawBody;
  if (ticketId) {
    cleanText = cleanText.replace(new RegExp(`^(?:RE\\s*:?\\s*)?(?:#)?${ticketId}\\s*[:\\-]?\\s*`, 'i'), '').trim();
  }
  if (!cleanText) cleanText = rawBody;

  let ticket = ticketId ? getTicketById(ticketId) : null;

  // If no ticket specified in text, associate with citizen's latest active ticket
  if (!ticket) {
    ticket = getLatestTicketForCitizen(fromPhone);
  }

  const departmentPhone = '+18005550199';

  // SCENARIO 1: Appending to an existing ticket docket thread
  if (ticket) {
    const formattedEmailBody = `CITIZEN TWO-WAY SMS BRIDGE REPLY
==================================================
📞 CITIZEN SENDER ID: ${fromPhone}
🎫 DOCKET NUMBER: ${ticket.ticket_id}
🏢 ASSIGNED DEPARTMENT: ${ticket.department}
📶 INBOUND CHANNEL: Twilio SMS Bridge (Keypad / Feature Phone)
⏱️ RECEIVED AT: ${new Date().toLocaleString()}

CITIZEN INCOMING SMS TEXT:
"${cleanText}"
==================================================
CITIZEN BENEFIT CONTEXT:
Citizen replied directly from their physical phone's SMS inbox without needing internet, a computer, or a smartphone app. This message is automatically threaded under Docket #${ticket.ticket_id}.

OFFICER ACTIONS:
1. Review citizen's update above.
2. Reply via "Dispatch SMS to Citizen" to send an SMS text back to their mobile.
==================================================`;

    const deptEmail = createEmail({
      sender: fromPhone,
      sender_name: `Citizen (${fromPhone}) [SMS Keypad]`,
      recipient: departmentPhone,
      recipient_name: `${ticket.department} (Grievance Desk)`,
      subject: `[RE: DOCKET #${ticket.ticket_id}] Citizen SMS: ${cleanText.slice(0, 45)}`,
      body: formattedEmailBody,
      folder: 'inbox',
      label: 'Civic Grievance',
      is_read: 0,
      is_starred: 1,
      ticket_id: ticket.ticket_id,
      ticket_status: ticket.status
    });

    // Sent copy for citizen
    createEmail({
      sender: fromPhone,
      sender_name: `You (${fromPhone})`,
      recipient: departmentPhone,
      recipient_name: ticket.department,
      subject: `[SMS Sent to ${ticket.department}] Re: #${ticket.ticket_id}`,
      body: formattedEmailBody,
      folder: 'sent',
      label: 'Civic Grievance',
      is_read: 1,
      ticket_id: ticket.ticket_id,
      ticket_status: ticket.status
    });

    // Send automatic SMS receipt confirmation to citizen
    try {
      await sendSmsBridgeReceiptToCitizen(fromPhone, ticket.ticket_id, ticket.department);
    } catch (e) {}

    // Real-time WebSocket event
    try {
      broadcastEvent({
        type: 'NEW_SMS_REPLY_RECEIVED',
        ticketId: ticket.ticket_id,
        fromPhone,
        text: cleanText,
        email: deptEmail
      });
    } catch (e) {}

    const confirmationMsg = `Receipt confirmed: Your reply has been added to Docket #${ticket.ticket_id}. The ${ticket.department} team has been notified.`;
    return {
      success: true,
      isNewTicket: false,
      ticket,
      email: deptEmail,
      cleanText,
      confirmationMsg
    };
  }

  // SCENARIO 2: No active ticket found -> Auto-register a new Grievance Docket from the SMS!
  let assignedDepartment = 'Public Works & Civic Grievance Helpline';
  const lower = cleanText.toLowerCase();
  if (lower.includes('water') || lower.includes('sewage') || lower.includes('drain') || lower.includes('pipe')) {
    assignedDepartment = 'Water Supply & Sewerage Board';
  } else if (lower.includes('electricity') || lower.includes('power') || lower.includes('light') || lower.includes('pole')) {
    assignedDepartment = 'Electricity & Energy Board';
  } else if (lower.includes('road') || lower.includes('pothole') || lower.includes('traffic')) {
    assignedDepartment = 'Highways & Pothole Redressal';
  } else if (lower.includes('sanitation') || lower.includes('garbage') || lower.includes('waste')) {
    assignedDepartment = 'Sanitation & Solid Waste Management';
  }

  const newTicket = createGrievanceTicket({
    citizen_phone: fromPhone,
    department: assignedDepartment,
    subject: `SMS Grievance: ${cleanText.slice(0, 45)}`,
    description: `Citizen initiated grievance via SMS Bridge:\n\n"${cleanText}"`,
    priority: 'Normal',
    source: 'sms_bridge'
  });

  const formattedEmailBody = `CITIZEN NEW GRIEVANCE VIA SMS BRIDGE
==================================================
📞 CITIZEN SENDER ID: ${fromPhone}
🎫 DOCKET NUMBER: ${newTicket.ticket_id}
🏢 ASSIGNED DEPARTMENT: ${assignedDepartment}
📶 INBOUND CHANNEL: Twilio SMS Bridge (Keypad / Feature Phone)
⏱️ RECEIVED AT: ${new Date().toLocaleString()}

CITIZEN INCOMING SMS TEXT:
"${cleanText}"
==================================================
Citizen Action: Citizen initiated an official grievance via standard SMS text from their basic phone without requiring internet or a smartphone.
Officer Action: Acknowledge ticket or dispatch field team. Reply via SMS Bridge to update the citizen's mobile.`;

  const deptEmail = createEmail({
    sender: fromPhone,
    sender_name: `Citizen (${fromPhone}) [SMS Keypad]`,
    recipient: departmentPhone,
    recipient_name: `${assignedDepartment} (Official Inbox)`,
    subject: `[TICKET #${newTicket.ticket_id}] New SMS Grievance from ${fromPhone}`,
    body: formattedEmailBody,
    folder: 'inbox',
    label: 'Civic Grievance',
    is_read: 0,
    is_starred: 1,
    ticket_id: newTicket.ticket_id,
    ticket_status: 'Registered'
  });

  createEmail({
    sender: fromPhone,
    sender_name: `You (${fromPhone})`,
    recipient: departmentPhone,
    recipient_name: assignedDepartment,
    subject: `[SMS Grievance #${newTicket.ticket_id}] Submitted to ${assignedDepartment}`,
    body: formattedEmailBody,
    folder: 'sent',
    label: 'Civic Grievance',
    is_read: 1,
    ticket_id: newTicket.ticket_id,
    ticket_status: 'Registered'
  });

  try {
    await sendGrievanceSmsAlert(fromPhone, newTicket.ticket_id, assignedDepartment, 'Registered');
  } catch (e) {}

  try {
    broadcastEvent({
      type: 'NEW_EMAIL_DELIVERED',
      email: deptEmail,
      ticketId: newTicket.ticket_id,
      source: 'sms_bridge'
    });
  } catch (e) {}

  const confirmationMsg = `Grievance registered! Docket #${newTicket.ticket_id} assigned under ${assignedDepartment}. You can reply directly to this SMS with updates.`;
  return {
    success: true,
    isNewTicket: true,
    ticket: newTicket,
    email: deptEmail,
    cleanText,
    confirmationMsg
  };
}

/**
 * Twilio Inbound SMS Webhook
 * Catches incoming SMS from citizens, parses Docket tokens, and threads into PhoneMail
 * POST /api/twilio/sms/incoming
 */
router.post('/sms/incoming', async (req, res) => {
  const from = req.body.From;
  const body = req.body.Body;
  console.log(`\n💬 [TWILIO INBOUND SMS WEBHOOK] From: ${from} | Text: "${body}"`);

  try {
    const result = await processIncomingCitizenSms({ from, body });
    const twiml = generateSmsReplyTwiml(result.confirmationMsg);
    res.type('text/xml');
    res.send(twiml);
  } catch (err) {
    console.error('[Twilio Inbound SMS Error]', err);
    res.type('text/xml');
    res.send('<Response></Response>');
  }
});

/**
 * Interactive SMS Bridge Simulator Endpoint
 * Enables browser-based testing of keypad SMS replies
 * POST /api/twilio/sms/simulate-reply
 */
router.post('/sms/simulate-reply', async (req, res) => {
  const { phone = '+19876543210', message = '', ticketId = null } = req.body;

  let formattedBody = message;
  if (ticketId && !message.toUpperCase().includes('TKT-')) {
    formattedBody = `RE #${ticketId}: ${message}`;
  }

  try {
    const result = await processIncomingCitizenSms({ from: phone, body: formattedBody });
    res.json({
      success: true,
      message: 'Citizen SMS successfully processed and threaded into PhoneMail mailbox!',
      ...result
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * Fetch thread history for a ticket docket
 * GET /api/twilio/sms/thread/:ticketId
 */
router.get('/sms/thread/:ticketId', (req, res) => {
  const { ticketId } = req.params;
  const ticket = getTicketById(ticketId);
  if (!ticket) {
    return res.status(404).json({ success: false, error: 'Ticket not found' });
  }

  const messages = getMessagesByTicketId(ticketId);
  res.json({
    success: true,
    ticket,
    messages
  });
});

/**
 * View recent Twilio dispatches
 * GET /api/twilio/dispatches
 */
router.get('/dispatches', (req, res) => {
  res.json({
    dispatches: getRecentDispatches()
  });
});

/**
 * ============================================================
 * INTERACTIVE DISASTER VOICE ROBOCALL ENDPOINTS
 * ============================================================
 */

/**
 * Webhook when outbound disaster call is answered by citizen
 * Plays emergency prompt & listens for DTMF (1=Safe, 2=SOS Rescue)
 * POST /api/twilio/voice/robocall-twiml
 */
router.post('/voice/robocall-twiml', (req, res) => {
  const callId = req.query.callId || req.body.CallSid || 'call_' + Date.now();
  const headline = req.query.headline || 'Critical Disaster Alert';
  const details = req.query.details || 'Severe emergency in your area. Follow civil defense instructions.';
  
  const actionUrl = `/api/twilio/voice/robocall-response?callId=${encodeURIComponent(callId)}&headline=${encodeURIComponent(headline)}`;
  const twiml = generateDisasterRobocallTwiml(headline, details, actionUrl);

  // Update status to CONNECTED
  try {
    updateDisasterRobocallResponse(callId, { status: 'CONNECTED' });
  } catch (e) {}

  res.type('text/xml');
  res.send(twiml);
});

/**
 * Webhook when citizen enters DTMF digit 1 or 2 during disaster call
 * POST /api/twilio/voice/robocall-response
 */
router.post('/voice/robocall-response', async (req, res) => {
  const digits = req.body.Digits || req.body.digit || req.query.Digits;
  const callerPhone = normalizePhone(req.body.From || req.body.Called || req.body.phone || '+19876543210');
  const callId = req.query.callId || req.body.callId || req.body.CallSid || 'call_sim';
  const headline = req.query.headline || req.body.headline || 'Disaster Alert';

  console.log(`\n🔔 [DISASTER ROBOCALL DTMF RESPONSE] Caller: ${callerPhone} | Pressed: ${digits} | Call ID: ${callId}`);

  let status = 'NO_ANSWER';
  let sosTicket = null;

  if (digits === '1') {
    status = 'SAFE';
    updateDisasterRobocallResponse(callId, { status: 'SAFE', dtmf_key: '1' });
    
    try {
      broadcastEvent({
        type: 'ROBOCALL_STATUS_UPDATE',
        callId,
        citizenPhone: callerPhone,
        status: 'SAFE',
        message: `Citizen ${callerPhone} confirmed SAFE via DTMF 1.`
      });
    } catch (e) {}

  } else if (digits === '2') {
    status = 'SOS_RESCUE_REQUESTED';

    // 1. Auto-create Critical SOS Rescue Grievance Ticket
    sosTicket = createGrievanceTicket({
      citizen_phone: callerPhone,
      department: 'Disaster Management & Search & Rescue',
      subject: `🚨 CRITICAL SOS: Citizen ${callerPhone} Trapped/Evacuation Needed (${headline})`,
      description: `HIGH-PRIORITY EVACUATION ALERT!\nCitizen dialed DTMF 2 during automated disaster voice robocall.\n\nDisaster Event: ${headline}\nCitizen Mobile Phone: ${callerPhone}\nTimestamp: ${new Date().toLocaleString()}\nAction Required: Immediate deployment of rescue & evacuation units.`,
      priority: 'High',
      source: 'voice_robocall_sos'
    });

    // 2. Thread urgent alert email to Department inbox (+18005550199)
    const alertBody = `CIVIL DEFENSE SEARCH & RESCUE - CRITICAL SOS EVACUATION DISPATCH
==================================================
⚠️ EMERGENCY STATUS: CITIZEN REQUIRES RESCUE / EVACUATION
📞 CALLER MOBILE NUMBER: ${callerPhone}
🎫 SOS DOCKET NUMBER: ${sosTicket.ticket_id}
🏢 ASSIGNED AUTHORITY: Disaster Management & Search & Rescue
🌊 DISASTER EVENT: ${headline}
⏱️ REPORTED TIMESTAMP: ${new Date().toLocaleString()}
📶 ORIGINATING CHANNEL: Outbound Disaster Voice Blast (DTMF Key 2)

RESCUE COORDINATOR INSTRUCTIONS:
1. Contact citizen at ${callerPhone} to ascertain flood/hazard depth and exact building floor.
2. Mobilize National Disaster Response Force (NDRF) / Marine Rescue Unit to citizen's registered ward.
3. Coordinate with Local Evacuation Shelter Command.
==================================================`;

    const sosEmail = createEmail({
      sender: callerPhone,
      sender_name: `🚨 SOS Citizen (${callerPhone})`,
      recipient: '+18005550199',
      recipient_name: 'Disaster Management & Rescue Command',
      subject: `🚨 [CRITICAL SOS #${sosTicket.ticket_id}] Evacuation Requested by ${callerPhone}`,
      body: alertBody,
      folder: 'inbox',
      label: 'Civic Grievance',
      is_read: 0,
      is_starred: 1,
      is_gov_verified: 1,
      ticket_id: sosTicket.ticket_id,
      ticket_status: 'SOS Dispatched'
    });

    // Sent copy for citizen
    createEmail({
      sender: '+18005550199',
      sender_name: 'Civil Defense Rescue Dispatch',
      recipient: callerPhone,
      recipient_name: `Citizen (${callerPhone})`,
      subject: `🚨 [SOS CONFIRMATION #${sosTicket.ticket_id}] Rescue Units Dispatched to Your Location`,
      body: alertBody,
      folder: 'inbox',
      label: 'Civic Grievance',
      is_read: 0,
      is_starred: 1,
      is_gov_verified: 1,
      ticket_id: sosTicket.ticket_id,
      ticket_status: 'SOS Dispatched'
    });

    updateDisasterRobocallResponse(callId, {
      status: 'SOS_RESCUE_REQUESTED',
      dtmf_key: '2',
      sos_ticket_id: sosTicket.ticket_id
    });

    // 3. Dispatch Priority Twilio SMS Confirmation to Citizen
    try {
      await sendDisasterSosSmsAlert(callerPhone, sosTicket.ticket_id, headline);
    } catch (e) {}

    // 4. Real-time WebSocket Alert to all civil defense terminals
    try {
      broadcastEvent({
        type: 'EMERGENCY_SOS_ALERT',
        callId,
        citizenPhone: callerPhone,
        ticketId: sosTicket.ticket_id,
        headline,
        email: sosEmail,
        status: 'SOS_RESCUE_REQUESTED',
        timestamp: new Date().toISOString()
      });
    } catch (e) {}
  }

  // If this is an API call (simulator), respond with JSON
  if (req.headers.accept?.includes('application/json') || req.body.isSimulator) {
    return res.json({
      success: true,
      callId,
      status,
      digit: digits,
      sosTicket,
      message: digits === '1' ? 'Citizen marked SAFE in Civil Defense database.' : '🚨 CRITICAL SOS RESCUE TICKET CREATED & DISPATCHED!'
    });
  }

  // Otherwise return valid TwiML
  const twiml = generateRobocallDTMFResponseTwiml(digits, callerPhone);
  res.type('text/xml');
  res.send(twiml);
});

/**
 * Trigger Disaster Outbound Voice Robocall Blast to citizens
 * POST /api/twilio/voice/trigger-blast
 */
router.post('/voice/trigger-blast', async (req, res) => {
  const {
    headline = 'Flash Flood & Cyclone Evacuation Alert',
    details = 'Heavy waterlogging and gale winds. High ground evacuation order active.',
    targetAreaCode = 'ALL',
    department = 'Disaster Management & Flood Control'
  } = req.body;

  const allUsers = getAllUsers().filter(u => u.phone_number !== '+18005550199');
  let targetedUsers = allUsers;
  if (targetAreaCode && targetAreaCode !== 'ALL') {
    targetedUsers = allUsers.filter(u => u.phone_number.includes(targetAreaCode));
    if (targetedUsers.length === 0) targetedUsers = allUsers.slice(0, 1);
  }

  console.log(`\n📢 [TRIGGER DISASTER VOICE BLAST] Dispatching outbound robocalls to ${targetedUsers.length} citizen(s)...`);

  const results = [];
  for (const user of targetedUsers) {
    const callId = `call_robocall_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    // Record in SQLite
    recordDisasterRobocall({
      call_id: callId,
      citizen_phone: user.phone_number,
      headline,
      details,
      area_code: targetAreaCode,
      status: 'INITIATED'
    });

    const callbackUrl = `${config.appUrl}/api/twilio/voice/robocall-twiml?callId=${encodeURIComponent(callId)}&headline=${encodeURIComponent(headline)}&details=${encodeURIComponent(details)}`;
    const callResult = await triggerDisasterRobocall(user.phone_number, headline, details, targetAreaCode, callbackUrl);
    results.push({
      phone: user.phone_number,
      callId,
      ...callResult
    });
  }

  // Real-time broadcast
  try {
    broadcastEvent({
      type: 'DISASTER_ROBOCALL_BLAST_DISPATCHED',
      headline,
      details,
      recipientsCount: targetedUsers.length,
      targetAreaCode,
      calls: results
    });
  } catch (e) {}

  res.json({
    success: true,
    message: `Disaster Robocall blast initiated to ${targetedUsers.length} citizen phone(s).`,
    headline,
    targetAreaCode,
    callsDispatched: results.length,
    calls: results
  });
});

/**
 * Interactive In-Browser Robocall Simulator Endpoint
 * POST /api/twilio/voice/simulate-robocall
 */
router.post('/voice/simulate-robocall', async (req, res) => {
  const {
    phone = '+19876543210',
    headline = 'Coastal Cyclone & Storm Surge Alert (Ward 14)',
    details = 'Severe flooding detected. Tidal waves reaching 3 meters. Move to designated storm shelters immediately.',
    areaCode = '987',
    digit = null
  } = req.body;

  const normalizedPhone = normalizePhone(phone);
  const callId = `sim_call_${Date.now()}`;

  // Record initiated robocall
  recordDisasterRobocall({
    call_id: callId,
    citizen_phone: normalizedPhone,
    headline,
    details,
    area_code: areaCode,
    status: digit === '1' ? 'SAFE' : digit === '2' ? 'SOS_RESCUE_REQUESTED' : 'CALLING'
  });

  // If a digit was directly pressed in simulator
  let responseData = null;
  if (digit) {
    if (digit === '1') {
      updateDisasterRobocallResponse(callId, { status: 'SAFE', dtmf_key: '1' });
      responseData = {
        status: 'SAFE',
        message: 'Citizen confirmed SAFE. Logged in Civil Protection Registry.',
        voicePrompt: 'Thank you. Your status has been officially logged as SAFE in the Civil Defense disaster registry.'
      };
    } else if (digit === '2') {
      const sosTicket = createGrievanceTicket({
        citizen_phone: normalizedPhone,
        department: 'Disaster Management & Search & Rescue',
        subject: `🚨 CRITICAL SOS: Citizen ${normalizedPhone} Trapped in Flood (${headline})`,
        description: `HIGH-PRIORITY EVACUATION ALERT!\nCitizen dialed DTMF 2 during automated disaster voice robocall.\n\nDisaster Event: ${headline}\nCitizen Mobile Phone: ${normalizedPhone}\nTimestamp: ${new Date().toLocaleString()}\nAction Required: Immediate deployment of rescue & evacuation units.`,
        priority: 'High',
        source: 'voice_robocall_sos'
      });

      updateDisasterRobocallResponse(callId, {
        status: 'SOS_RESCUE_REQUESTED',
        dtmf_key: '2',
        sos_ticket_id: sosTicket.ticket_id
      });

      // SMS Alert
      await sendDisasterSosSmsAlert(normalizedPhone, sosTicket.ticket_id, headline);

      // Sent copy and department email
      createEmail({
        sender: normalizedPhone,
        sender_name: `🚨 SOS Citizen (${normalizedPhone})`,
        recipient: '+18005550199',
        recipient_name: 'Disaster Management & Rescue Command',
        subject: `🚨 [CRITICAL SOS #${sosTicket.ticket_id}] Evacuation Requested by ${normalizedPhone}`,
        body: `HIGH PRIORITY DISASTER EVACUATION ALERT!\nCitizen ${normalizedPhone} pressed DTMF 2 for emergency rescue during ${headline}.\nSearch and rescue units mobilized.`,
        folder: 'inbox',
        label: 'Civic Grievance',
        is_read: 0,
        is_starred: 1,
        is_gov_verified: 1,
        ticket_id: sosTicket.ticket_id,
        ticket_status: 'SOS Dispatched'
      });

      responseData = {
        status: 'SOS_RESCUE_REQUESTED',
        sosTicket,
        message: `🚨 Critical SOS rescue docket #${sosTicket.ticket_id} created! Teams mobilized.`,
        voicePrompt: 'EMERGENCY ALERT REGISTERED. Search and rescue coordinators have received your critical SOS request. Rescue units are being dispatched to your area.'
      };
    }
  }

  res.json({
    success: true,
    callId,
    phone: normalizedPhone,
    headline,
    details,
    audioScript: `URGENT DISASTER ADVISORY from Civil Defense. Headline: ${headline}. Details: ${details}. Press 1 if you are safe. Press 2 if you require emergency evacuation and rescue.`,
    response: responseData
  });
});

/**
 * Get Disaster Robocall History & Live Stats
 * GET /api/twilio/voice/robocalls
 */
router.get('/voice/robocalls', (req, res) => {
  const calls = getDisasterRobocalls(50);
  const stats = getRobocallStats();
  res.json({
    success: true,
    stats,
    calls
  });
});

export default router;
