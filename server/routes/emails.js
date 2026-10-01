import express from 'express';
import {
  createEmail,
  getEmailById,
  getEmailsForUser,
  getConversationThread,
  markEmailRead,
  toggleEmailStar,
  moveEmailFolder,
  updateEmailLabel,
  getFolderCounts,
  findOrCreateUser,
  getUserByIdentifier,
  getUserByPhone,
  normalizePhone,
  phoneToEmail,
  createGrievanceTicket,
  getTicketsForCitizen,
  updateTicketStatus,
  getAllUsers,
  recordDisasterRobocall,
  db
} from '../db.js';
import {
  sendIncomingEmailAlert,
  sendGrievanceSmsAlert,
  sendEmergencyBroadcastSms,
  sendOfficerSmsReplyToCitizen,
  triggerDisasterRobocall
} from '../services/twilioService.js';
import { broadcastEvent } from '../index.js';

const router = express.Router();

function getRequestUser(req) {
  return (
    req.query.user ||
    req.headers['x-user-phone'] ||
    req.body.userPhone ||
    req.body.sender ||
    req.cookies?.phonemail_user
  );
}

/**
 * Send an email (Supports Citizen-to-Government Grievance Auto-Detection)
 * POST /api/emails/send
 */
router.post('/send', async (req, res) => {
  const {
    sender,
    sender_name = '',
    recipient,
    subject,
    body,
    label = null,
    attachments = []
  } = req.body;

  const activeSender = sender || getRequestUser(req);

  if (!activeSender) {
    return res.status(400).json({ error: 'Sender phone number is required.' });
  }

  if (!recipient || !recipient.trim()) {
    return res.status(400).json({ error: 'Recipient phone or email is required.' });
  }

  if (!subject || !subject.trim()) {
    return res.status(400).json({ error: 'Subject line is required.' });
  }

  if (!body || !body.trim()) {
    return res.status(400).json({ error: 'Message body cannot be empty.' });
  }

  const senderUser = getUserByPhone(normalizePhone(activeSender)) || getUserByIdentifier(activeSender);
  const normSender = senderUser ? senderUser.phone_number : (normalizePhone(activeSender) || activeSender);
  const resolvedSenderName = sender_name || senderUser?.name || normSender;

  // Resolve recipient flexibly (phone, email, name, or badge ID)
  const cleanRecipient = recipient.trim();
  let normRecipient = '';
  let resolvedRecipientName = '';

  const matchedRecipient = getUserByIdentifier(cleanRecipient) || getUserByPhone(normalizePhone(cleanRecipient.replace(/@phonemail\.com/i, '')));
  if (matchedRecipient) {
    normRecipient = matchedRecipient.phone_number;
    resolvedRecipientName = matchedRecipient.name || matchedRecipient.phone_number;
  } else {
    const candidatePhone = normalizePhone(cleanRecipient.replace(/@phonemail\.com/i, ''));
    if (candidatePhone && candidatePhone.length >= 8) {
      normRecipient = candidatePhone;
      resolvedRecipientName = candidatePhone;
    } else {
      const userByName = db.prepare('SELECT * FROM users WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE ? LIMIT 1').get(cleanRecipient, `%${cleanRecipient.toLowerCase()}%`);
      if (userByName) {
        normRecipient = userByName.phone_number;
        resolvedRecipientName = userByName.name;
      } else {
        normRecipient = candidatePhone || cleanRecipient;
        resolvedRecipientName = cleanRecipient;
      }
    }
  }

  // Detect whether recipient is a Civic/Gov Department or citizen grievance
  const isCivicGrievance = 
    label === 'Civic Grievance' ||
    recipient.toLowerCase().includes('.gov') ||
    recipient.toLowerCase().includes('water@') ||
    recipient.toLowerCase().includes('roads@') ||
    recipient.toLowerCase().includes('electricity@') ||
    recipient.toLowerCase().includes('sanitation@') ||
    recipient.toLowerCase().includes('grievance@');

  let ticketId = null;
  let ticketStatus = null;
  let assignedDepartment = 'Public Works & Civic Admin';

  if (isCivicGrievance) {
    if (recipient.toLowerCase().includes('water')) assignedDepartment = 'Water Supply & Sewerage Board';
    else if (recipient.toLowerCase().includes('electricity') || recipient.toLowerCase().includes('power')) assignedDepartment = 'Electricity & Energy Board';
    else if (recipient.toLowerCase().includes('road') || recipient.toLowerCase().includes('pothole')) assignedDepartment = 'Highways & Pothole Redressal';
    else if (recipient.toLowerCase().includes('sanitation') || recipient.toLowerCase().includes('waste')) assignedDepartment = 'Sanitation & Waste Management';

    const ticket = createGrievanceTicket({
      citizen_phone: normSender,
      department: assignedDepartment,
      subject: subject.trim(),
      description: body.trim(),
      priority: 'Normal',
      source: 'email'
    });

    ticketId = ticket.ticket_id;
    ticketStatus = ticket.status;

    // Send automated SMS grievance receipt to citizen's phone via Twilio
    try {
      sendGrievanceSmsAlert(normSender, ticketId, assignedDepartment, 'Registered');
    } catch (err) {}
  }

  // Detect Government Verified Sender
  const isGovVerified = 
    normSender.includes('5551000') ||
    (resolvedSenderName && resolvedSenderName.toLowerCase().includes('govt')) ||
    (resolvedSenderName && resolvedSenderName.toLowerCase().includes('department')) ||
    (resolvedSenderName && resolvedSenderName.toLowerCase().includes('kpr institute')) ||
    (resolvedSenderName && resolvedSenderName.toLowerCase().includes('civic'));

  // Ensure recipient user exists in database
  if (normRecipient) {
    findOrCreateUser(normRecipient, resolvedRecipientName || normRecipient, 'auto_receive');
  }

  // Insert email into SQLite
  const email = createEmail({
    sender: normSender,
    sender_name: resolvedSenderName,
    recipient: normRecipient,
    recipient_name: resolvedRecipientName || normRecipient,
    subject: subject.trim(),
    body: body.trim(),
    folder: 'inbox',
    label: isCivicGrievance ? 'Civic Grievance' : label,
    is_read: 0,
    is_starred: 0,
    has_attachments: attachments && attachments.length > 0 ? 1 : 0,
    attachments: attachments || [],
    is_gov_verified: isGovVerified ? 1 : 0,
    ticket_id: ticketId,
    ticket_status: ticketStatus
  });

  // Regular incoming email SMS alert if not already sent as grievance
  if (!isCivicGrievance) {
    try {
      sendIncomingEmailAlert(normRecipient, normSender, subject);
    } catch (err) {}
  }

  // Broadcast real-time event to connected browsers
  try {
    broadcastEvent({
      type: 'NEW_EMAIL_DELIVERED',
      email,
      ticketId
    });
  } catch (err) {}

  res.status(201).json({
    success: true,
    message: isCivicGrievance ? `Grievance registered with ticket ID ${ticketId}` : 'Email delivered successfully.',
    email,
    ticketId,
    ticketStatus
  });
});

/**
 * Dispatch Emergency Civic Broadcast / Disaster Alert
 * Supports targeting specific phone area codes or all registered citizens
 * POST /api/emails/broadcast
 */
router.post('/broadcast', async (req, res) => {
  const {
    department = 'Disaster Management & Civic Authority',
    headline,
    severity = 'CRITICAL',
    targetAreaCode = 'all',
    sendSms = true
  } = req.body;
  const details = req.body.details || req.body.message;

  if (!headline || !details) {
    return res.status(400).json({ error: 'Headline and details/message are required for civic broadcast.' });
  }

  // Determine targeted citizen audience by phone area code / prefix
  const allUsers = getAllUsers();
  let targetedUsers = allUsers;
  let targetDescription = 'All Registered Citizens';

  if (targetAreaCode && targetAreaCode !== 'all' && targetAreaCode !== '*') {
    const cleanPrefix = targetAreaCode.replace(/[^0-9]/g, '');
    targetedUsers = allUsers.filter(u => {
      const cleanPhone = (u.phone_number || '').replace(/[^0-9]/g, '');
      return cleanPhone.includes(cleanPrefix) || cleanPhone.startsWith(cleanPrefix);
    });
    targetDescription = `Citizens in Area Code / Prefix (${targetAreaCode})`;
  }

  const broadcastEmail = createEmail({
    sender: 'CIVIC-ALERTS',
    sender_name: `${department} [Authorized Government Admin]`,
    recipient: targetAreaCode === 'all' ? 'ALL_CITIZENS' : `CITIZENS_AREA_${targetAreaCode}`,
    recipient_name: targetDescription,
    subject: `🚨 EMERGENCY NOTICE: ${headline.replace(/^🚨\s*EMERGENCY\s*(ALERT|NOTICE):\s*/i, '')}`,
    body: `DISASTER MANAGEMENT & CIVIC AUTHORITY - EMERGENCY BROADCAST\n==================================================\nTarget Audience: ${targetDescription}\nSeverity Level: ${severity}\nIssuing Authority: ${department}\nTime of Dispatch: ${new Date().toLocaleString()}\n\nOFFICIAL EMERGENCY ADVISORY:\n${details}\n==================================================\nNote: This priority broadcast bypasses standard filters and is pinned to your PhoneMail inbox. Follow instructions from official municipal responders.`,
    folder: 'inbox',
    label: 'Civic Grievance',
    is_read: 0,
    is_starred: 1,
    is_gov_verified: 1,
    is_broadcast: 1
  });

  // Dispatch priority Twilio SMS broadcast to recipients' physical phones
  const smsDispatches = [];
  if (sendSms) {
    try {
      targetedUsers.forEach(u => {
        if (u.phone_number && u.phone_number.length >= 8) {
          sendEmergencyBroadcastSms(u.phone_number, headline, details);
          smsDispatches.push(u.phone_number);
        }
      });
      console.log(`📡 [CIVIC BROADCAST SMS DISPATCHED] Sent priority alerts to ${smsDispatches.length} citizens in ${targetDescription}`);
    } catch (err) {
      console.error('[Broadcast SMS Error]', err.message);
    }
  }

  // Dispatch interactive voice robocalls to citizens if requested
  const triggerRobocall = req.body.triggerRobocall || req.body.triggerVoiceCalls;
  const robocallDispatches = [];
  if (triggerRobocall) {
    try {
      for (const u of targetedUsers) {
        if (u.phone_number && u.phone_number.length >= 8) {
          const callId = `call_robocall_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          recordDisasterRobocall({
            call_id: callId,
            citizen_phone: u.phone_number,
            headline,
            details,
            area_code: targetAreaCode,
            status: 'INITIATED'
          });
          triggerDisasterRobocall(u.phone_number, headline, details, targetAreaCode);
          robocallDispatches.push({ phone: u.phone_number, callId });
        }
      }
      console.log(`📞 [CIVIC BROADCAST ROBOCALLS] Dispatched voice robocalls to ${robocallDispatches.length} citizens`);
    } catch (err) {
      console.error('[Broadcast Robocall Error]', err.message);
    }
  }

  // Real-time broadcast to active browser windows
  try {
    broadcastEvent({
      type: 'CIVIC_EMERGENCY_BROADCAST',
      email: broadcastEmail,
      headline,
      department,
      details,
      severity,
      targetAreaCode,
      recipientCount: targetedUsers.length,
      robocallsDispatched: robocallDispatches.length
    });
  } catch (err) {}

  res.json({
    success: true,
    message: `Emergency Civic Broadcast successfully dispatched to ${targetedUsers.length} citizen(s) in ${targetDescription}.`,
    broadcast: broadcastEmail,
    targetAreaCode,
    recipientsTargeted: targetedUsers.length,
    smsDispatchedCount: smsDispatches.length,
    robocallsDispatchedCount: robocallDispatches.length
  });
});

/**
 * List emails for user
 * GET /api/emails
 */
router.get('/', (req, res) => {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }

  const { folder, label, filter, search } = req.query;

  const emails = getEmailsForUser(user, {
    folder: folder || 'inbox',
    label: label || null,
    filter: filter || 'all',
    search: search || ''
  });

  res.json({ emails, count: emails.length });
});

/**
 * Get citizen's registered grievance tickets
 * GET /api/emails/tickets
 */
router.get('/tickets', (req, res) => {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }

  const tickets = getTicketsForCitizen(user);
  res.json({ tickets, count: tickets.length });
});

/**
 * Update grievance ticket status (e.g. Under Review, Resolved)
 * PATCH /api/emails/tickets/:ticketId/status
 */
router.patch('/tickets/:ticketId/status', (req, res) => {
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'Status is required.' });
  }

  const updated = updateTicketStatus(req.params.ticketId, status);
  if (!updated) {
    return res.status(404).json({ error: 'Ticket not found.' });
  }

  try {
    broadcastEvent({
      type: 'TICKET_STATUS_UPDATED',
      ticket: updated
    });
  } catch (e) {}

  res.json({ success: true, ticket: updated });
});

/**
 * Get conversation threads
 * GET /api/emails/threads
 */
router.get('/threads', (req, res) => {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }

  const normUser = normalizePhone(user);
  const emailAddr = phoneToEmail(normUser);

  const query = `
    SELECT 
      CASE 
        WHEN sender IN (?, ?) THEN recipient 
        ELSE sender 
      END as contact_phone,
      COUNT(*) as total_messages,
      SUM(CASE WHEN recipient IN (?, ?) AND is_read = 0 THEN 1 ELSE 0 END) as unread_count,
      MAX(timestamp) as last_activity
    FROM emails
    WHERE sender IN (?, ?) OR recipient IN (?, ?)
    GROUP BY contact_phone
    ORDER BY last_activity DESC
  `;

  const rows = db.prepare(query).all(
    normUser, emailAddr,
    normUser, emailAddr,
    normUser, emailAddr, normUser, emailAddr
  );

  const threads = rows.map(r => {
    const lastMsg = db.prepare(`
      SELECT * FROM emails 
      WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
      ORDER BY timestamp DESC LIMIT 1
    `).get(normUser, r.contact_phone, r.contact_phone, normUser);

    return {
      contact_phone: r.contact_phone,
      total_messages: r.total_messages,
      unread_count: r.unread_count || 0,
      last_activity: r.last_activity,
      last_subject: lastMsg ? lastMsg.subject : '',
      last_body: lastMsg ? lastMsg.body : ''
    };
  });

  res.json({ threads, count: threads.length });
});

/**
 * Get thread messages
 * GET /api/emails/threads/:contactPhone
 */
router.get('/threads/:contactPhone', (req, res) => {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }

  const messages = getConversationThread(user, req.params.contactPhone);
  res.json({ user, contact: req.params.contactPhone, messages, count: messages.length });
});

/**
 * Get counts
 * GET /api/emails/counts
 */
router.get('/counts', (req, res) => {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(400).json({ error: 'User identifier is required.' });
  }
  res.json(getFolderCounts(user));
});

// In-memory translation cache to guarantee instant responses on repeated queries
const translationCache = new Map();

/**
 * Robust Single Text Translation with Cache
 */
async function translateSingleText(text, targetLang = 'en', sourceLang = 'auto') {
  if (!text || !text.trim()) return '';
  const cleanTarget = (targetLang || 'en').split('-')[0].toLowerCase();
  if (cleanTarget === 'en' && sourceLang === 'en') return text;

  const cacheKey = `${sourceLang}->${cleanTarget}::${text.trim()}`;
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey);
  }

  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${cleanTarget}&dt=t&q=${encodeURIComponent(text.trim())}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!response.ok) {
      throw new Error(`Upstream translation status ${response.status}`);
    }
    const data = await response.json();
    let translated = '';
    if (data && Array.isArray(data[0])) {
      translated = data[0].map(item => (item && item[0]) ? item[0] : '').join('');
    } else {
      translated = text.trim();
    }
    translationCache.set(cacheKey, translated);
    return translated;
  } catch (err) {
    console.warn(`Translation error for text "${text.slice(0, 40)}":`, err.message);
    return text.trim();
  }
}

/**
 * Universal Multi-Language Translation (Single text)
 * POST /api/emails/translate
 */
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLang = 'en', sourceLang = 'auto' } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Text is required for translation.' });
    }
    const cleanTarget = targetLang.split('-')[0].toLowerCase();
    const translatedText = await translateSingleText(text, cleanTarget, sourceLang);
    res.json({ success: true, translatedText, targetLang: cleanTarget });
  } catch (err) {
    console.error('Translation error:', err);
    res.status(500).json({ error: err.message, translatedText: req.body?.text || '' });
  }
});

/**
 * Batch Email Translation for Inbox List & Snippets
 * POST /api/emails/translate-batch
 */
router.post('/translate-batch', async (req, res) => {
  try {
    const { items, targetLang = 'en', sourceLang = 'auto' } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ success: true, translations: {} });
    }
    const cleanTarget = (targetLang || 'en').split('-')[0].toLowerCase();
    
    // If English, return original texts immediately without external requests
    if (cleanTarget === 'en') {
      const orig = {};
      items.forEach(it => {
        orig[it.id] = {
          subject: it.subject || '',
          snippet: (it.body || '').replace(/\n+/g, ' ').slice(0, 160)
        };
      });
      return res.json({ success: true, targetLang: 'en', translations: orig });
    }

    const translations = {};
    // Parallel translation with Promise.all
    await Promise.all(items.map(async (item) => {
      try {
        const cleanSubj = item.subject || '';
        const cleanSnippet = (item.body || '').replace(/\n+/g, ' ').slice(0, 160);
        
        const [subjTrans, snipTrans] = await Promise.all([
          translateSingleText(cleanSubj, cleanTarget, sourceLang),
          translateSingleText(cleanSnippet, cleanTarget, sourceLang)
        ]);

        translations[item.id] = {
          subject: subjTrans || cleanSubj,
          snippet: snipTrans || cleanSnippet
        };
      } catch (e) {
        translations[item.id] = {
          subject: item.subject || '',
          snippet: (item.body || '').replace(/\n+/g, ' ').slice(0, 160)
        };
      }
    }));

    res.json({ success: true, targetLang: cleanTarget, translations });
  } catch (err) {
    console.error('Batch translation error:', err);
    res.status(500).json({ error: err.message, translations: {} });
  }
});

/**
 * Full Email Translation (Subject + Full Body)
 * POST /api/emails/translate-email
 */
router.post('/translate-email', async (req, res) => {
  try {
    const { id, subject, body, targetLang = 'en', sourceLang = 'auto' } = req.body;
    const cleanTarget = (targetLang || 'en').split('-')[0].toLowerCase();

    if (cleanTarget === 'en') {
      return res.json({
        success: true,
        id,
        targetLang: 'en',
        subject: subject || '',
        body: body || ''
      });
    }

    const [transSubj, transBody] = await Promise.all([
      translateSingleText(subject || '', cleanTarget, sourceLang),
      translateSingleText(body || '', cleanTarget, sourceLang)
    ]);

    res.json({
      success: true,
      id,
      targetLang: cleanTarget,
      subject: transSubj || subject,
      body: transBody || body
    });
  } catch (err) {
    console.error('Full email translation error:', err);
    res.status(500).json({
      error: err.message,
      subject: req.body?.subject || '',
      body: req.body?.body || ''
    });
  }
});

/**
 * Audio TTS Voice Stream (Native Pronunciation for Tamil, Hindi, Telugu, Kannada, Spanish, etc.)
 * GET /api/emails/tts
 */
router.get('/tts', async (req, res) => {
  try {
    const { text, lang = 'en' } = req.query;
    if (!text || !text.trim()) {
      return res.status(400).send('Text is required.');
    }
    const cleanLang = (lang || 'en').split('-')[0].toLowerCase();
    const snippet = text.trim().slice(0, 300);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${cleanLang}&client=tw-ob&q=${encodeURIComponent(snippet)}`;
    const audioRes = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    if (!audioRes.ok) {
      return res.status(audioRes.status).send('TTS upstream error');
    }
    res.set({
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'public, max-age=86400'
    });
    const arrayBuffer = await audioRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).send(err.message);
  }
});

/**
 * Get single email by ID
 * GET /api/emails/:id
 */
router.get('/:id', (req, res) => {
  const email = getEmailById(req.params.id);
  if (!email) {
    return res.status(404).json({ error: 'Email not found.' });
  }
  res.json({ email });
});

/**
 * Toggle starred status
 * PATCH /api/emails/:id/star
 */
router.patch('/:id/star', (req, res) => {
  const updated = toggleEmailStar(req.params.id);
  if (!updated) {
    return res.status(404).json({ error: 'Email not found.' });
  }
  try {
    broadcastEvent({ type: 'EMAIL_STAR_UPDATED', email: updated });
  } catch (e) {}
  res.json({ success: true, email: updated });
});

/**
 * Mark read / unread
 * PATCH /api/emails/:id/read
 */
router.patch('/:id/read', (req, res) => {
  const isRead = req.body.is_read !== undefined ? req.body.is_read : 1;
  const updated = markEmailRead(req.params.id, isRead);
  if (!updated) {
    return res.status(404).json({ error: 'Email not found.' });
  }
  try {
    broadcastEvent({ type: 'EMAIL_READ_UPDATED', email: updated });
  } catch (e) {}
  res.json({ success: true, email: updated });
});

/**
 * Move folder
 * PATCH /api/emails/:id/folder
 */
router.patch('/:id/folder', (req, res) => {
  const { folder } = req.body;
  if (!folder) {
    return res.status(400).json({ error: 'Folder name is required.' });
  }
  const updated = moveEmailFolder(req.params.id, folder);
  if (!updated) {
    return res.status(404).json({ error: 'Email not found.' });
  }
  try {
    broadcastEvent({ type: 'EMAIL_MOVED', email: updated });
  } catch (e) {}
  res.json({ success: true, email: updated });
});

/**
 * Update label
 * PATCH /api/emails/:id/label
 */
router.patch('/:id/label', (req, res) => {
  const { label } = req.body;
  const updated = updateEmailLabel(req.params.id, label);
  if (!updated) {
    return res.status(404).json({ error: 'Email not found.' });
  }
  try {
    broadcastEvent({ type: 'EMAIL_LABEL_UPDATED', email: updated });
  } catch (e) {}
  res.json({ success: true, email: updated });
});



/**
 * Officer replies to citizen via SMS Bridge
 * Dispatches a Twilio SMS text to citizen's physical mobile and records in email thread
 * POST /api/emails/reply-sms
 */
router.post('/reply-sms', async (req, res) => {
  const ticketId = req.body.ticketId || req.body.ticket_id;
  const citizenPhone = req.body.citizenPhone || req.body.citizen_phone || req.body.to_phone;
  const replyText = req.body.replyText || req.body.reply_text || req.body.reply_body;
  const department = req.body.department || req.body.department_name || 'Public Works & Civic Grievance';
  const officerPhone = req.body.officerPhone || req.body.officer_phone || req.body.department_phone || '+18005550199';
  const officerName = req.body.officerName || req.body.officer_name || 'Department Redressal Officer';

  if (!ticketId || !citizenPhone || !replyText) {
    return res.status(400).json({ error: 'ticketId, citizenPhone, and replyText are required.' });
  }

  const normalizedCitizen = normalizePhone(citizenPhone);
  const normalizedOfficer = normalizePhone(officerPhone);

  const formattedBody = `DEPARTMENT OFFICIAL UPDATE (DISPATCHED VIA SMS)
==================================================
🏢 ISSUING DEPARTMENT: ${department}
🎫 DOCKET NUMBER: ${ticketId}
📞 RECIPIENT CITIZEN PHONE: ${normalizedCitizen}
⏱️ DISPATCH TIMESTAMP: ${new Date().toLocaleString()}

OFFICIAL RESPONSE MESSAGE:
"${replyText}"
==================================================
Notice: This response has been simultaneously transmitted to citizen ${normalizedCitizen}'s mobile phone as a priority SMS. The citizen can reply directly to the SMS to post updates.`;

  // 1. Create email in citizen's inbox
  const citizenEmail = createEmail({
    sender: normalizedOfficer,
    sender_name: `${department} [Officer ${officerName}]`,
    recipient: normalizedCitizen,
    recipient_name: `Citizen (${normalizedCitizen})`,
    subject: `[DOCKET #${ticketId} UPDATE] Official Response from ${department}`,
    body: formattedBody,
    folder: 'inbox',
    label: 'Civic Grievance',
    is_read: 0,
    is_starred: 1,
    is_gov_verified: 1,
    ticket_id: ticketId,
    ticket_status: 'In Progress'
  });

  // 2. Create sent copy in department's sent folder
  createEmail({
    sender: normalizedOfficer,
    sender_name: `${department} [Officer]`,
    recipient: normalizedCitizen,
    recipient_name: `Citizen (${normalizedCitizen})`,
    subject: `[SMS Dispatched] Update on #${ticketId} to ${normalizedCitizen}`,
    body: formattedBody,
    folder: 'sent',
    label: 'Civic Grievance',
    is_read: 1,
    is_gov_verified: 1,
    ticket_id: ticketId,
    ticket_status: 'In Progress'
  });

  // 3. Update ticket status in DB
  try {
    updateTicketStatus(ticketId, 'In Progress');
  } catch (e) {}

  // 4. Dispatch Twilio SMS to citizen's physical mobile
  let smsResult = { mock: true };
  try {
    smsResult = await sendOfficerSmsReplyToCitizen(normalizedCitizen, ticketId, replyText, department);
  } catch (err) {
    console.error('[SMS Dispatch Error]', err);
  }

  // 5. Broadcast WebSocket event
  try {
    broadcastEvent({
      type: 'NEW_EMAIL_DELIVERED',
      email: citizenEmail,
      ticketId,
      source: 'officer_sms_reply'
    });
  } catch (e) {}

  res.json({
    success: true,
    message: `Official response recorded and dispatched to citizen ${normalizedCitizen} via SMS!`,
    ticketId,
    email: citizenEmail,
    smsDispatched: true,
    smsResult
  });
});

export default router;
