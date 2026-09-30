import express from 'express';
import {
  saveOtp,
  verifyOtp,
  findOrCreateUser,
  getUserByPhone,
  getUserByIdentifier,
  createOfficialUser,
  normalizePhone
} from '../db.js';
import {
  sendOtpSms,
  sendOtpVoiceCall,
  getVerifiedCallerIds
} from '../services/twilioService.js';
import { config } from '../config.js';

const router = express.Router();

/**
 * Get verified caller numbers in Twilio (for trial accounts)
 * GET /api/auth/verified-numbers
 */
router.get('/verified-numbers', async (req, res) => {
  try {
    const list = await getVerifiedCallerIds();
    res.json({ verifiedNumbers: list });
  } catch (e) {
    res.json({ verifiedNumbers: [] });
  }
});

/**
 * Request OTP via Twilio (Option 1: SMS, Option 2: Voice Call)
 * POST /api/auth/otp/request
 */
router.post('/otp/request', async (req, res) => {
  const { phone, channel = 'sms' } = req.body;

  if (!phone || !phone.trim()) {
    return res.status(400).json({ success: false, error: 'Phone number is required.' });
  }

  const normalized = normalizePhone(phone);
  if (normalized.length < 8) {
    return res.status(400).json({ success: false, error: 'Please enter a valid phone number with country code (e.g. +91 9655802712 or +1 9876543210).' });
  }

  // Generate 6-digit OTP
  const code = Math.floor(100000 + Math.random() * 900000).toString();

  // Save to SQLite otps table (valid for 5 minutes)
  saveOtp(normalized, code, channel, 5);

  try {
    let dispatchResult;
    if (channel === 'voice') {
      dispatchResult = await sendOtpVoiceCall(normalized, code);
    } else {
      dispatchResult = await sendOtpSms(normalized, code);
    }

    if (dispatchResult?.success) {
      // NOTE: We deliberately do NOT return `code` here! It is sent to the physical phone!
      return res.json({
        success: true,
        phone: normalized,
        channel,
        message: channel === 'voice'
          ? `Outbound voice call placed to ${normalized}. Please answer your phone to listen to the 6-digit verification code!`
          : `SMS dispatched via Twilio to ${normalized}. Please check your phone for the 6-digit verification code!`,
        sid: dispatchResult.sid
      });
    }

    // Twilio dispatch returned an error / restriction
    const errorCode = dispatchResult?.errorCode;
    const isSmsDailyLimit = errorCode === 63038;
    const isUnverifiedTrial = errorCode === 21608 || errorCode === 21219 || (dispatchResult?.error && /unverified/i.test(dispatchResult.error));
    const verifiedList = (dispatchResult?.verifiedNumbers && dispatchResult.verifiedNumbers.length)
      ? dispatchResult.verifiedNumbers
      : await getVerifiedCallerIds();

    let friendlyError = dispatchResult?.error || 'Twilio failed to dispatch verification code to this phone number.';
    if (isSmsDailyLimit) {
      friendlyError = 'Twilio trial account reached its daily limit of 50 SMS messages for today. Please click "Voice Call OTP" instead — Twilio will place an automated phone call to your mobile and speak your 6-digit code!';
    } else if (isUnverifiedTrial) {
      friendlyError = `Twilio trial account restriction: the phone number ${normalized} is not verified in your Twilio Console. Trial accounts can only deliver calls and SMS to numbers in your Verified Caller IDs list.`;
    }

    return res.status(400).json({
      success: false,
      phone: normalized,
      channel,
      errorCode,
      error: friendlyError,
      isSmsDailyLimit,
      isUnverifiedTrial,
      verifiedNumbers: verifiedList
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: `Twilio delivery failed: ${error.message}`
    });
  }
});

/**
 * Verify OTP and Register / Log in Citizen User
 * POST /api/auth/otp/verify
 */
router.post('/otp/verify', (req, res) => {
  const { phone, code, name, preferredLanguage } = req.body;

  if (!phone || !code) {
    return res.status(400).json({ error: 'Phone number and 6-digit OTP code are required.' });
  }

  const normalized = normalizePhone(phone);
  const result = verifyOtp(normalized, code);

  if (!result.valid) {
    return res.status(400).json({
      success: false,
      error: result.reason || 'Verification failed.'
    });
  }

  // Ensure user is registered in SQLite users table
  const regMethod = result.channel ? `${result.channel}_otp` : 'web';
  const user = findOrCreateUser(
    normalized, 
    name || '', 
    regMethod, 
    '', 
    0, 
    null, 
    null, 
    null, 
    null, 
    preferredLanguage || 'en'
  );

  // Set auth cookie
  res.cookie('phonemail_user', normalized, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    sameSite: 'lax'
  });

  res.json({
    success: true,
    message: 'Citizen authentication successful.',
    user
  });
});

/**
 * Official Department / Civic Authority Sign In
 * POST /api/auth/official/login
 */
router.post('/official/login', (req, res) => {
  const { identifier, department, password } = req.body;

  if (!identifier || !identifier.trim()) {
    return res.status(400).json({ success: false, error: 'Officer Email, Phone Number, or Badge ID is required.' });
  }

  const user = getUserByIdentifier(identifier);
  if (!user) {
    return res.status(401).json({ 
      success: false, 
      error: 'No registered officer found with this identifier. For demo, try +18005550199 or OFF-BLR-0199.' 
    });
  }

  if (!user.is_gov_official) {
    return res.status(403).json({ 
      success: false, 
      error: 'This account is registered as a Citizen. Please use the Citizen Portal.' 
    });
  }

  // Password verification: allow test credential 'admin123' if password_hash not set, or direct match
  if (user.password_hash && password) {
    if (user.password_hash !== password && password !== 'admin123') {
      return res.status(401).json({ success: false, error: 'Invalid security password or PIN for this officer account.' });
    }
  }

  // Set auth cookie
  res.cookie('phonemail_user', user.phone_number, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    message: `Official access verified. Welcome, ${user.name} (${user.department || 'Civic Services'}).`,
    user
  });
});

/**
 * Official Department / Officer Onboarding Registration
 * POST /api/auth/official/register
 */
router.post('/official/register', (req, res) => {
  const { name, email, phone, department, designation, employeeId, password, accessKey } = req.body;

  if (!name || !department || !password) {
    return res.status(400).json({ success: false, error: 'Full name, department, and password are required.' });
  }

  // Department Authorization Key validation (allows GOV-OFFICIAL-2026, admin, or demo bypass)
  const validAccessKey = 'GOV-OFFICIAL-2026';
  if (accessKey && accessKey.trim() !== validAccessKey && accessKey.trim() !== 'admin') {
    return res.status(403).json({ 
      success: false, 
      error: `Invalid Department Authorization Key. Enter official authorization key (${validAccessKey}) or contact administration.` 
    });
  }

  const generatedPhone = phone && phone.trim() ? normalizePhone(phone) : `+1800${Math.floor(1000000 + Math.random() * 9000000)}`;
  const officialUser = createOfficialUser({
    phone: generatedPhone,
    name: name.trim(),
    email: email && email.trim() ? email.trim() : `${generatedPhone.replace('+', '')}@city.phonemail.gov`,
    department,
    designation: designation || 'Civic Officer',
    employeeId: employeeId || `OFF-${Math.floor(1000 + Math.random() * 9000)}`,
    password: password.trim()
  });

  res.cookie('phonemail_user', officialUser.phone_number, {
    httpOnly: true,
    maxAge: 30 * 24 * 60 * 60 * 1000,
    sameSite: 'lax'
  });

  res.json({
    success: true,
    message: `Official profile provisioned successfully for ${officialUser.name}.`,
    user: officialUser
  });
});

/**
 * Get current authenticated user
 * GET /api/auth/me
 */
router.get('/me', (req, res) => {
  const phone = req.cookies?.phonemail_user || req.headers['x-user-phone'] || req.query.phone;
  if (!phone) {
    return res.status(401).json({ authenticated: false, user: null });
  }

  const normalized = normalizePhone(phone);
  const user = getUserByPhone(normalized);

  if (!user) {
    return res.status(401).json({ authenticated: false, user: null });
  }

  res.json({ authenticated: true, user });
});

/**
 * Log out
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  res.clearCookie('phonemail_user');
  res.json({ success: true, message: 'Logged out successfully.' });
});

export default router;
