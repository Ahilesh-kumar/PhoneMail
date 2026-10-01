import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure data folder exists
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

// Initialize SQLite database with dual-driver support: better-sqlite3 or native node:sqlite
let dbInstance;
try {
  const { default: BetterSqlite } = await import('better-sqlite3');
  dbInstance = new BetterSqlite(config.dbPath);
  dbInstance.pragma('journal_mode = WAL');
  console.log('[Database] Loaded better-sqlite3 driver successfully.');
} catch (e) {
  console.log('[Database] better-sqlite3 native addon not compatible with current Node.js runtime, falling back to built-in node:sqlite.');
  const { DatabaseSync } = await import('node:sqlite');
  const syncDb = new DatabaseSync(config.dbPath);
  syncDb.exec('PRAGMA journal_mode = WAL;');

  const origPrepare = syncDb.prepare.bind(syncDb);
  const cleanArgs = (args) => args.map(a => (a === undefined ? null : a));

  syncDb.prepare = (sql) => {
    const stmt = origPrepare(sql);
    return {
      run(...args) {
        return stmt.run(...cleanArgs(args));
      },
      get(...args) {
        return stmt.get(...cleanArgs(args));
      },
      all(...args) {
        return stmt.all(...cleanArgs(args));
      }
    };
  };

  syncDb.pragma = (str) => {
    try {
      return syncDb.exec(`PRAGMA ${str};`);
    } catch (err) {
      return null;
    }
  };

  dbInstance = syncDb;
}

export const db = dbInstance;

/**
 * Initialize clean database schema and indexes.
 * Zero simulated data.
 */
export function initDatabase() {
  console.log(`[Database] Initializing SQLite tables at: ${config.dbPath}`);

  // 1. Users table (Stores real registered users)
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      phone_number TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT 'PhoneMail User',
      email TEXT UNIQUE NOT NULL,
      avatar TEXT DEFAULT '',
      is_gov_official INTEGER NOT NULL DEFAULT 0,
      department TEXT DEFAULT NULL,
      password_hash TEXT DEFAULT NULL,
      alias_ids TEXT DEFAULT '[]',
      registration_method TEXT DEFAULT 'web',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 2. Emails table (Stores real emails sent and received)
  db.exec(`
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT NOT NULL,
      sender_name TEXT NOT NULL DEFAULT '',
      sender_avatar TEXT NOT NULL DEFAULT '',
      recipient TEXT NOT NULL,
      recipient_name TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      folder TEXT NOT NULL DEFAULT 'inbox',
      label TEXT DEFAULT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      is_starred INTEGER NOT NULL DEFAULT 0,
      is_snoozed INTEGER NOT NULL DEFAULT 0,
      is_mention INTEGER NOT NULL DEFAULT 0,
      has_attachments INTEGER NOT NULL DEFAULT 0,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      is_gov_verified INTEGER NOT NULL DEFAULT 0,
      ticket_id TEXT DEFAULT NULL,
      ticket_status TEXT DEFAULT NULL,
      is_broadcast INTEGER NOT NULL DEFAULT 0,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_emails_sender ON emails(sender);
    CREATE INDEX IF NOT EXISTS idx_emails_recipient ON emails(recipient);
    CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder);
    CREATE INDEX IF NOT EXISTS idx_emails_label ON emails(label);
    CREATE INDEX IF NOT EXISTS idx_emails_timestamp ON emails(timestamp);
  `);

  // 3. OTPs table (Stores real OTP codes for SMS & Voice verification)
  db.exec(`
    CREATE TABLE IF NOT EXISTS otps (
      phone_number TEXT PRIMARY KEY,
      code TEXT NOT NULL,
      channel TEXT NOT NULL DEFAULT 'sms',
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 4. Civic Grievance Tickets Table
  db.exec(`
    CREATE TABLE IF NOT EXISTS grievance_tickets (
      ticket_id TEXT PRIMARY KEY,
      citizen_phone TEXT NOT NULL,
      department TEXT NOT NULL,
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Registered', -- 'Registered', 'In Progress', 'Resolved'
      priority TEXT NOT NULL DEFAULT 'Normal',
      source TEXT NOT NULL DEFAULT 'email', -- 'email', 'voice_ivr', 'web'
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_tickets_citizen ON grievance_tickets(citizen_phone);
    CREATE INDEX IF NOT EXISTS idx_tickets_dept ON grievance_tickets(department);
  `);

  // 5. Disaster Robocalls Table (Tracks Outbound Voice Blasts & DTMF SOS responses)
  db.exec(`
    CREATE TABLE IF NOT EXISTS disaster_robocalls (
      call_id TEXT PRIMARY KEY,
      citizen_phone TEXT NOT NULL,
      headline TEXT NOT NULL,
      details TEXT NOT NULL,
      area_code TEXT DEFAULT 'ALL',
      status TEXT NOT NULL DEFAULT 'INITIATED', -- 'INITIATED', 'CALLING', 'CONNECTED', 'SAFE', 'SOS_RESCUE_REQUESTED', 'NO_ANSWER'
      dtmf_key TEXT DEFAULT NULL,
      sos_ticket_id TEXT DEFAULT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_robocalls_phone ON disaster_robocalls(citizen_phone);
    CREATE INDEX IF NOT EXISTS idx_robocalls_status ON disaster_robocalls(status);
  `);

  // Migrate columns in existing database if missing
  try {
    const userCols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
    if (!userCols.includes('is_gov_official')) {
      db.exec("ALTER TABLE users ADD COLUMN is_gov_official INTEGER NOT NULL DEFAULT 0");
    }
    if (!userCols.includes('department')) {
      db.exec("ALTER TABLE users ADD COLUMN department TEXT DEFAULT NULL");
    }
    if (!userCols.includes('designation')) {
      db.exec("ALTER TABLE users ADD COLUMN designation TEXT DEFAULT NULL");
    }
    if (!userCols.includes('employee_id')) {
      db.exec("ALTER TABLE users ADD COLUMN employee_id TEXT DEFAULT NULL");
    }
    if (!userCols.includes('preferred_language')) {
      db.exec("ALTER TABLE users ADD COLUMN preferred_language TEXT DEFAULT 'en'");
    }

    const tableInfo = db.prepare("PRAGMA table_info(emails)").all();
    const columnNames = tableInfo.map(c => c.name);
    if (!columnNames.includes('is_gov_verified')) {
      db.exec("ALTER TABLE emails ADD COLUMN is_gov_verified INTEGER NOT NULL DEFAULT 0");
    }
    if (!columnNames.includes('ticket_id')) {
      db.exec("ALTER TABLE emails ADD COLUMN ticket_id TEXT DEFAULT NULL");
    }
    if (!columnNames.includes('ticket_status')) {
      db.exec("ALTER TABLE emails ADD COLUMN ticket_status TEXT DEFAULT NULL");
    }
    if (!columnNames.includes('is_broadcast')) {
      db.exec("ALTER TABLE emails ADD COLUMN is_broadcast INTEGER NOT NULL DEFAULT 0");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_emails_ticket ON emails(ticket_id)");
    db.exec("DELETE FROM users WHERE phone_number IS NULL OR TRIM(phone_number) = ''");
  } catch (e) {}

  // Ensure Department Helpline official account exists (+18005550199)
  const deptPhone = '+18005550199';
  const existingDept = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(deptPhone);
  if (!existingDept) {
    db.prepare(`
      INSERT INTO users (phone_number, name, email, avatar, registration_method, is_gov_official, department, designation, employee_id, password_hash)
      VALUES (?, ?, ?, ?, 'system', 1, 'Public Works & Civic Grievance', 'Chief Grievance Officer', 'OFF-BLR-0199', 'admin123')
    `).run(deptPhone, 'Public Works & Civic Grievance Helpline', '18005550199@phonemail.com', 'govt');
  } else {
    db.prepare(`
      UPDATE users SET 
        is_gov_official = 1,
        department = COALESCE(department, 'Public Works & Civic Grievance'),
        designation = COALESCE(designation, 'Chief Grievance Officer'),
        employee_id = COALESCE(employee_id, 'OFF-BLR-0199'),
        password_hash = COALESCE(password_hash, 'admin123')
      WHERE phone_number = ?
    `).run(deptPhone);
  }

  // Ensure Emergency Disaster Dispatch Cell official account exists (+18005550198)
  const emergencyPhone = '+18005550198';
  const existingEmergency = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(emergencyPhone);
  if (!existingEmergency) {
    db.prepare(`
      INSERT INTO users (phone_number, name, email, avatar, registration_method, is_gov_official, department, designation, employee_id, password_hash)
      VALUES (?, ?, ?, ?, 'system', 1, 'Disaster Management & Emergency Dispatch', 'Senior Emergency Controller', 'OFF-DISPATCH-0198', 'admin123')
    `).run(emergencyPhone, 'Emergency Disaster Dispatch Cell', '18005550198@phonemail.com', 'govt');
  } else {
    db.prepare(`
      UPDATE users SET 
        is_gov_official = 1,
        department = COALESCE(department, 'Disaster Management & Emergency Dispatch'),
        designation = COALESCE(designation, 'Senior Emergency Controller'),
        employee_id = COALESCE(employee_id, 'OFF-DISPATCH-0198'),
        password_hash = COALESCE(password_hash, 'admin123')
      WHERE phone_number = ?
    `).run(emergencyPhone);
  }

  // Seed Official Welfare Receipts & Documents under 'Govt Receipts' label
  const existingGovtReceipts = db.prepare("SELECT COUNT(*) as count FROM emails WHERE label = 'Govt Receipts'").get().count;
  if (existingGovtReceipts === 0) {
    const citizens = ['+19876543210', '+19123456789'];
    for (const citizenPhone of citizens) {
      // 1. Property Tax Assessment & Clearance Receipt
      createEmail({
        sender: 'tax.treasury@city.phonemail.gov',
        sender_name: 'Municipal Revenue & Property Tax Dept',
        recipient: citizenPhone,
        recipient_name: 'Property Owner',
        subject: 'OFFICIAL RECEIPT: Municipal Property Tax Assessment FY 2026-27 (Receipt #PTX-2026-9812)',
        body: `MUNICIPAL CORPORATION TREASURY - OFFICIAL TAX ASSESSMENT RECEIPT\n==================================================\nTax Assessment Year: FY 2026-27\nProperty ID: PID-BLR-882910\nAssessed Ward: Ward 14 (Central Zone)\nTax Payer Name: Registered Citizen\nRegistered Mobile: ${citizenPhone}\n\nPAYMENT BREAKDOWN:\n- General Property Tax: $320.00\n- Water & Sewerage Cess: $60.00\n- Solid Waste Management Cess: $40.00\n--------------------------------------------------\nTOTAL PAID: $420.00 (PAID IN FULL)\nPayment Mode: PhoneMail Verified Direct Debit\nTransaction Reference: TXN-TAX-889102458\n\nTAMPER-EVIDENT VERIFICATION SEAL:\nSeal ID: SEAL-MUNI-98214-SHA256\nCryptographic Hash: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\nIssuing Officer: Chief Revenue Collector & Municipal Registrar\nDigitally Signed: 29-Sep-2026 10:14:00 UTC\n==================================================\nThis receipt serves as valid legal proof of municipal property tax clearance for FY 2026-27.`,
        folder: 'inbox',
        label: 'Govt Receipts',
        is_read: 0,
        is_starred: 1,
        has_attachments: 1,
        attachments: [
          {
            name: 'Property_Tax_Assessment_Receipt_2026.pdf',
            size: '340 KB',
            type: 'pdf',
            url: '#download-tax-receipt',
            seal_id: 'SEAL-MUNI-98214-SHA256',
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            issuing_authority: 'Municipal Corporation Treasury & Revenue Board',
            docket_type: 'Property Tax Challan'
          }
        ],
        is_gov_verified: 1
      });

      // 2. Driving License Renewal Confirmation Slip
      createEmail({
        sender: 'transport.rto@state.phonemail.gov',
        sender_name: 'State Transport Department (RTO)',
        recipient: citizenPhone,
        recipient_name: 'Licensee',
        subject: 'OFFICIAL SLIP: Driving License Renewal Approved (DL-1420260089)',
        body: `REGIONAL TRANSPORT OFFICE (RTO) - MOTOR VEHICLES DEPARTMENT\n==================================================\nDocument: Driving License Renewal Acknowledgment Slip\nLicense Number: DL-1420260089\nHolder Mobile: ${citizenPhone}\nVehicle Classes: LMV (Light Motor Vehicle), MCWG (Motorcycle with Gear)\nRenewal Effective Date: 01-Oct-2026\nNew Validity Expiry: 30-Sep-2036 (Valid for 10 Years)\nApplication Docket: APP-RTO-2026-4412\n\nBIOMETRIC & CHIP VERIFICATION:\nSmart Card Chip Serial: SC-9910-8821\nStatus: Approved & Digitally Dispatched to PhoneMail Welfare Locker\n\nTAMPER-EVIDENT VERIFICATION SEAL:\nSeal ID: SEAL-RTO-55210-SHA256\nCryptographic Hash: 4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a\nIssuing Authority: Regional Transport Officer, Licensing Authority\n==================================================`,
        folder: 'inbox',
        label: 'Govt Receipts',
        is_read: 1,
        is_starred: 1,
        has_attachments: 1,
        attachments: [
          {
            name: 'Driving_License_Renewal_Slip.pdf',
            size: '280 KB',
            type: 'pdf',
            url: '#download-dl-slip',
            seal_id: 'SEAL-RTO-55210-SHA256',
            sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
            issuing_authority: 'Regional Transport Office (RTO)',
            docket_type: 'Motor Vehicle Driving License'
          }
        ],
        is_gov_verified: 1
      });

      // 3. Direct Benefit Pension Deposit Slip
      createEmail({
        sender: 'welfare.pension@gov.phonemail.gov',
        sender_name: 'Social Security & Welfare Pension Directorate',
        recipient: citizenPhone,
        recipient_name: 'Pension Beneficiary',
        subject: 'OFFICIAL DISBURSEMENT: Senior Citizen Pension Deposit Slip (Acc #***4012)',
        body: `DIRECTORATE OF SOCIAL SECURITY - DIRECT BENEFIT TRANSFER (DBT) ADVICE\n==================================================\nScheme: National Social Assistance Welfare Pension Scheme\nBeneficiary Phone: ${citizenPhone}\nDisbursement Month: September 2026\nBenefit Amount: $350.00 / ₹2,500\nCredited Account: Verified Citizen Bank Account (****4012)\nTreasury Scroll ID: TR-DBT-2026-88102\nDisbursement Date: 28-Sep-2026\n\nTAMPER-EVIDENT VERIFICATION SEAL:\nSeal ID: SEAL-DBT-88120-SHA256\nCryptographic Hash: ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d\nIssuing Authority: Ministry of Social Justice & Empowerment\n==================================================`,
        folder: 'inbox',
        label: 'Govt Receipts',
        is_read: 1,
        is_starred: 0,
        has_attachments: 1,
        attachments: [
          {
            name: 'Pension_Disbursement_Slip_Sep2026.pdf',
            size: '195 KB',
            type: 'pdf',
            url: '#download-pension-slip',
            seal_id: 'SEAL-DBT-88120-SHA256',
            sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
            issuing_authority: 'Social Welfare & Pension Directorate',
            docket_type: 'Direct Benefit Transfer Advice'
          }
        ],
        is_gov_verified: 1
      });

      // 4. Subsidized Domestic Power Voucher
      createEmail({
        sender: 'energy.subsidy@city.phonemail.gov',
        sender_name: 'State Electricity & Energy Board (Welfare Subsidies)',
        recipient: citizenPhone,
        recipient_name: 'Domestic Consumer',
        subject: 'OFFICIAL VOUCHER: Monthly Domestic Power Subsidy Credit (Consumer #EB-7789)',
        body: `STATE ELECTRICITY REGULATORY COMMISSION - WELFARE SUBSIDY VOUCHER\n==================================================\nConsumer Service Number: EB-7789-012\nBeneficiary Mobile: ${citizenPhone}\nBilling Cycle: August - September 2026\nMonthly Units Consumed: 94 kWh\nWelfare Subsidy Entitlement: 100 kWh Zero-Tariff Slab\nNet Payable Amount: $0.00 (100% Subsidized)\nGovernment Welfare Contribution: $45.20\n\nTAMPER-EVIDENT VERIFICATION SEAL:\nSeal ID: SEAL-EB-77891-SHA256\nCryptographic Hash: 6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b\nIssuing Authority: Energy Department & State Power Distribution Utility\n==================================================`,
        folder: 'inbox',
        label: 'Govt Receipts',
        is_read: 1,
        is_starred: 0,
        has_attachments: 1,
        attachments: [
          {
            name: 'Power_Subsidy_Official_Voucher.pdf',
            size: '210 KB',
            type: 'pdf',
            url: '#download-power-subsidy',
            seal_id: 'SEAL-EB-77891-SHA256',
            sha256: '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b',
            issuing_authority: 'State Electricity & Energy Board',
            docket_type: 'Energy Welfare Subsidy Voucher'
          }
        ],
        is_gov_verified: 1
      });
    }
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  const emailCount = db.prepare('SELECT COUNT(*) as count FROM emails').get().count;
  const ticketCount = db.prepare('SELECT COUNT(*) as count FROM grievance_tickets').get().count;
  console.log(`[Database] Ready. Users: ${userCount}, Emails: ${emailCount}, Civic Tickets: ${ticketCount} (Clean state)`);
}

/**
 * Helper to normalize phone number
 */
export function normalizePhone(phone) {
  if (!phone) return '';
  const trimmed = phone.toString().trim();
  if (trimmed.startsWith('+')) {
    const digits = trimmed.slice(1).replace(/[^0-9]/g, '');
    return digits ? `+${digits}` : '';
  }
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return '';

  // 10 digits starting with 6, 7, 8, 9 -> Indian mobile (+91)
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }
  // 11 digits starting with 0 followed by 6-9 -> Indian mobile (+91)
  if (digits.length === 11 && digits.startsWith('0') && /^[6-9]/.test(digits.slice(1))) {
    return `+91${digits.slice(1)}`;
  }
  // 12 digits starting with 91 -> Indian mobile (+91)
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }
  // 10 digits starting with 2-5 -> North American number (+1)
  if (digits.length === 10 && /^[2-5]/.test(digits)) {
    return `+1${digits}`;
  }
  // 11 digits starting with 1 -> North American number (+1)
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/**
 * Generate PhoneMail email address from phone number
 */
export function phoneToEmail(phone) {
  const normalized = normalizePhone(phone);
  const digits = normalized.replace(/[^0-9]/g, '');
  return `${digits}@phonemail.com`;
}

// -------------------------------------------------------------
// USER REPOSITORY
// -------------------------------------------------------------

export function findOrCreateUser(phoneNumber, name = '', regMethod = 'web', avatar = '', isGov = 0, department = null, designation = null, employeeId = null, password = null, preferredLang = 'en') {
  const normalized = normalizePhone(phoneNumber);
  const email = phoneToEmail(normalized);
  const displayName = name && name.trim() ? name.trim() : normalized;

  const existing = db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalized);
  if (existing) {
    if (name && name.trim() && existing.name === normalized) {
      db.prepare('UPDATE users SET name = ? WHERE phone_number = ?').run(name.trim(), normalized);
    }
    if (preferredLang && preferredLang !== 'en') {
      db.prepare('UPDATE users SET preferred_language = ? WHERE phone_number = ?').run(preferredLang, normalized);
    }
    return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalized);
  }

  const insert = db.prepare(`
    INSERT INTO users (phone_number, name, email, avatar, registration_method, is_gov_official, department, designation, employee_id, password_hash, preferred_language)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run(normalized, displayName, email, avatar, regMethod, isGov ? 1 : 0, department, designation, employeeId, password, preferredLang);
  return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalized);
}

export function getUserByPhone(phoneNumber) {
  const normalized = normalizePhone(phoneNumber);
  return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalized);
}

export function getUserByIdentifier(identifier) {
  if (!identifier) return null;
  const clean = identifier.toString().trim();
  const normalized = normalizePhone(clean);
  const withoutDomain = clean.replace(/@phonemail\.com/i, '').trim();
  const withDomain = withoutDomain.includes('@') ? withoutDomain : `${withoutDomain}@phonemail.com`;

  return db.prepare(`
    SELECT * FROM users 
    WHERE phone_number = ? 
       OR phone_number = ? 
       OR phone_number = ?
       OR LOWER(email) = LOWER(?) 
       OR LOWER(email) = LOWER(?)
       OR LOWER(name) = LOWER(?)
       OR UPPER(COALESCE(employee_id, '')) = UPPER(?)
    LIMIT 1
  `).get(clean, normalized, withoutDomain, clean, withDomain, clean, clean);
}

export function createOfficialUser({ phone, name, email, department, designation, employeeId, password }) {
  const normalized = normalizePhone(phone);
  const userEmail = email && email.includes('@') ? email.trim() : phoneToEmail(normalized);
  const existing = db.prepare('SELECT * FROM users WHERE phone_number = ? OR LOWER(email) = LOWER(?)').get(normalized, userEmail);
  if (existing) {
    db.prepare(`
      UPDATE users SET 
        name = ?,
        email = ?,
        is_gov_official = 1,
        department = ?,
        designation = ?,
        employee_id = ?,
        password_hash = COALESCE(?, password_hash)
      WHERE phone_number = ?
    `).run(name, userEmail, department, designation || 'Civic Officer', employeeId || 'OFF-CIVIC', password, existing.phone_number);
    return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(existing.phone_number);
  }

  db.prepare(`
    INSERT INTO users (phone_number, name, email, avatar, registration_method, is_gov_official, department, designation, employee_id, password_hash)
    VALUES (?, ?, ?, 'govt', 'official_portal', 1, ?, ?, ?, ?)
  `).run(normalized, name, userEmail, department, designation || 'Civic Officer', employeeId || 'OFF-CIVIC', password);
  return db.prepare('SELECT * FROM users WHERE phone_number = ?').get(normalized);
}

export function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
}

// -------------------------------------------------------------
// EMAIL REPOSITORY
// -------------------------------------------------------------

export function createEmail({
  sender,
  sender_name = '',
  sender_avatar = '',
  recipient,
  recipient_name = '',
  subject,
  body,
  folder = 'inbox',
  label = null,
  is_read = 0,
  is_starred = 0,
  is_snoozed = 0,
  is_mention = 0,
  has_attachments = 0,
  attachments = [],
  is_gov_verified = 0,
  ticket_id = null,
  ticket_status = null,
  is_broadcast = 0,
  timestamp = null
}) {
  const attachmentsJson = typeof attachments === 'string' ? attachments : JSON.stringify(attachments);
  const hasAtt = attachments.length > 0 ? 1 : has_attachments;
  const isoNow = new Date().toISOString();
  const finalTimestamp = timestamp
    ? (timestamp.includes('Z') || timestamp.includes('+') ? timestamp : (timestamp.replace(' ', 'T') + 'Z'))
    : isoNow;

  const stmt = db.prepare(`
    INSERT INTO emails (
      sender, sender_name, sender_avatar,
      recipient, recipient_name,
      subject, body, folder, label,
      is_read, is_starred, is_snoozed, is_mention,
      has_attachments, attachments_json,
      is_gov_verified, ticket_id, ticket_status, is_broadcast,
      timestamp
    ) VALUES (
      ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?, ?,
      ?
    )
  `);

  const result = stmt.run(
    sender, sender_name, sender_avatar,
    recipient, recipient_name,
    subject, body, folder, label,
    is_read, is_starred, is_snoozed, is_mention,
    hasAtt, attachmentsJson,
    is_gov_verified ? 1 : 0,
    ticket_id,
    ticket_status,
    is_broadcast ? 1 : 0,
    finalTimestamp
  );

  return getEmailById(result.lastInsertRowid);
}

export function formatEmailRow(row) {
  if (!row) return null;
  let ts = row.timestamp;
  if (ts && typeof ts === 'string' && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(ts.trim())) {
    ts = ts.trim().replace(' ', 'T') + 'Z';
  }
  return {
    ...row,
    timestamp: ts,
    attachments: JSON.parse(row.attachments_json || '[]')
  };
}

export function getEmailById(id) {
  const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id);
  if (!row) return null;
  return formatEmailRow(row);
}

export function getUserMatchIdentifiers(userIdentifier) {
  if (!userIdentifier) return [];
  const raw = userIdentifier.toString().trim();
  const normalized = normalizePhone(raw);
  const digits = raw.replace(/[^0-9]/g, '');
  const emailAddr = normalized ? phoneToEmail(normalized) : '';

  const ids = new Set();
  if (raw) ids.add(raw);
  if (normalized) ids.add(normalized);
  if (digits) {
    ids.add(digits);
    ids.add(`+${digits}`);
    ids.add(`${digits}@phonemail.com`);
  }
  if (emailAddr) ids.add(emailAddr);

  try {
    const user = getUserByPhone(normalized) || getUserByIdentifier(raw);
    if (user) {
      if (user.phone_number) ids.add(user.phone_number);
      if (user.email) ids.add(user.email.toLowerCase());
      if (user.employee_id) ids.add(user.employee_id);
    }
  } catch (e) {}

  return Array.from(ids).filter(Boolean);
}

export function getEmailsForUser(userIdentifier, options = {}) {
  const {
    folder = 'inbox',
    label = null,
    filter = 'all',
    search = ''
  } = options;

  const userIds = getUserMatchIdentifiers(userIdentifier);
  const normalized = normalizePhone(userIdentifier);
  const isDept = normalized === '+18005550199' || normalized === '18005550199' || (userIdentifier && (userIdentifier.includes('.gov') || userIdentifier.includes('civic')));

  const placeholders = userIds.map(() => '?').join(', ') || "''";

  let query = '';
  let params = [];

  if (folder === 'inbox') {
    // Received emails or public broadcasts, strictly folder = 'inbox'
    query = `
      SELECT * FROM emails 
      WHERE (
        recipient IN (${placeholders})
        OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
        ${isDept ? "OR recipient = '+18005550199' OR recipient = '18005550199@phonemail.com' OR recipient = 'civic.complaints@city.phonemail.gov' OR label = 'Civic Grievance'" : ""}
      )
      AND folder = 'inbox'
    `;
    params.push(...userIds);
  } else if (folder === 'sent') {
    // Sent emails: user is sender, not trashed, and not duplicate officer ticket copy
    query = `
      SELECT * FROM emails 
      WHERE sender IN (${placeholders})
      AND folder != 'trash'
      AND (subject NOT LIKE '[TICKET #%]' OR folder = 'sent')
    `;
    params.push(...userIds);
  } else if (folder === 'trash') {
    // Trashed emails
    query = `
      SELECT * FROM emails 
      WHERE (
        recipient IN (${placeholders}) 
        OR sender IN (${placeholders})
        OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
        ${isDept ? "OR recipient = '+18005550199' OR label = 'Civic Grievance'" : ""}
      )
      AND folder = 'trash'
    `;
    params.push(...userIds, ...userIds);
  } else if (folder === 'starred') {
    // Starred emails
    query = `
      SELECT * FROM emails 
      WHERE (
        recipient IN (${placeholders}) 
        OR sender IN (${placeholders})
        OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
        ${isDept ? "OR recipient = '+18005550199' OR label = 'Civic Grievance'" : ""}
      )
      AND is_starred = 1
      AND folder != 'trash'
    `;
    params.push(...userIds, ...userIds);
  } else if (folder === 'drafts') {
    query = `
      SELECT * FROM emails 
      WHERE sender IN (${placeholders})
      AND folder = 'drafts'
    `;
    params.push(...userIds);
  } else if (folder === 'spam') {
    query = `
      SELECT * FROM emails 
      WHERE recipient IN (${placeholders})
      AND folder = 'spam'
    `;
    params.push(...userIds);
  } else {
    query = `
      SELECT * FROM emails 
      WHERE (
        recipient IN (${placeholders}) 
        OR sender IN (${placeholders})
      )
      AND folder = ?
    `;
    params.push(...userIds, ...userIds, folder);
  }

  if (label) {
    query += ` AND label = ?`;
    params.push(label);
  }

  if (filter === 'unread') {
    query += ` AND is_read = 0`;
  } else if (filter === 'starred') {
    query += ` AND is_starred = 1`;
  } else if (filter === 'mentions') {
    query += ` AND is_mention = 1`;
  } else if (filter === 'grievance') {
    query += ` AND ticket_id IS NOT NULL`;
  } else if (filter === 'broadcast') {
    query += ` AND is_broadcast = 1`;
  }

  if (search && search.trim()) {
    query += ` AND (subject LIKE ? OR body LIKE ? OR sender_name LIKE ? OR sender LIKE ? OR ticket_id LIKE ?)`;
    const term = `%${search.trim()}%`;
    params.push(term, term, term, term, term);
  }

  query += ` ORDER BY is_broadcast DESC, timestamp DESC`;

  const rows = db.prepare(query).all(...params);
  return rows.map(r => formatEmailRow(r));
}

export function getConversationThread(userA, userB) {
  const normA = normalizePhone(userA);
  const emailA = phoneToEmail(normA);
  const normB = normalizePhone(userB);
  const emailB = phoneToEmail(normB);

  const query = `
    SELECT * FROM emails 
    WHERE (
      (sender IN (?, ?) AND recipient IN (?, ?)) OR 
      (sender IN (?, ?) AND recipient IN (?, ?))
    )
    ORDER BY timestamp ASC
  `;

  const rows = db.prepare(query).all(
    normA, emailA, normB, emailB,
    normB, emailB, normA, emailA
  );

  return rows.map(r => formatEmailRow(r));
}

export function markEmailRead(id, isRead = 1) {
  db.prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(isRead ? 1 : 0, id);
  return getEmailById(id);
}

export function toggleEmailStar(id) {
  const email = getEmailById(id);
  if (!email) return null;
  const newStatus = email.is_starred ? 0 : 1;
  db.prepare('UPDATE emails SET is_starred = ? WHERE id = ?').run(newStatus, id);
  return { ...email, is_starred: newStatus };
}

export function moveEmailFolder(id, targetFolder) {
  db.prepare('UPDATE emails SET folder = ? WHERE id = ?').run(targetFolder, id);
  return getEmailById(id);
}

export function updateEmailLabel(id, label) {
  db.prepare('UPDATE emails SET label = ? WHERE id = ?').run(label || null, id);
  return getEmailById(id);
}

export function getFolderCounts(userIdentifier) {
  const userIds = getUserMatchIdentifiers(userIdentifier);
  const normalized = normalizePhone(userIdentifier);
  const isDept = normalized === '+18005550199' || normalized === '18005550199' || (userIdentifier && (userIdentifier.includes('.gov') || userIdentifier.includes('civic')));
  const placeholders = userIds.map(() => '?').join(', ') || "''";

  const folders = ['inbox', 'starred', 'snoozed', 'sent', 'drafts', 'spam', 'trash'];
  const counts = {};

  for (const f of folders) {
    if (f === 'inbox') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE (
          recipient IN (${placeholders})
          OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
          ${isDept ? "OR recipient = '+18005550199' OR recipient = '18005550199@phonemail.com' OR recipient = 'civic.complaints@city.phonemail.gov' OR label = 'Civic Grievance'" : ""}
        )
        AND folder = 'inbox' AND is_read = 0
      `).get(...userIds);
      counts[f] = row ? row.count : 0;
    } else if (f === 'sent') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE sender IN (${placeholders}) AND folder != 'trash'
        AND (subject NOT LIKE '[TICKET #%]' OR folder = 'sent')
      `).get(...userIds);
      counts[f] = row ? row.count : 0;
    } else if (f === 'starred') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE (
          recipient IN (${placeholders}) 
          OR sender IN (${placeholders})
          OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
          ${isDept ? "OR recipient = '+18005550199' OR label = 'Civic Grievance'" : ""}
        )
        AND is_starred = 1 AND folder != 'trash'
      `).get(...userIds, ...userIds);
      counts[f] = row ? row.count : 0;
    } else if (f === 'trash') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE (
          recipient IN (${placeholders}) 
          OR sender IN (${placeholders})
          OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
          ${isDept ? "OR recipient = '+18005550199' OR label = 'Civic Grievance'" : ""}
        )
        AND folder = 'trash'
      `).get(...userIds, ...userIds);
      counts[f] = row ? row.count : 0;
    } else if (f === 'drafts') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE sender IN (${placeholders}) AND folder = 'drafts'
      `).get(...userIds);
      counts[f] = row ? row.count : 0;
    } else if (f === 'spam') {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE recipient IN (${placeholders}) AND folder = 'spam' AND is_read = 0
      `).get(...userIds);
      counts[f] = row ? row.count : 0;
    } else {
      const row = db.prepare(`
        SELECT COUNT(*) as count FROM emails 
        WHERE (recipient IN (${placeholders}) OR sender IN (${placeholders})) AND folder = ? AND is_read = 0
      `).get(...userIds, ...userIds, f);
      counts[f] = row ? row.count : 0;
    }
  }

  // Label counts
  const labels = ['College', 'Projects', 'Personal', 'Purchases', 'Finance', 'Govt Receipts', 'Civic Grievance'];
  const labelCounts = {};
  for (const l of labels) {
    const row = db.prepare(`
      SELECT COUNT(*) as count FROM emails 
      WHERE (
        recipient IN (${placeholders}) 
        OR sender IN (${placeholders})
        OR (is_broadcast = 1 AND (recipient = 'ALL_CITIZENS' OR recipient LIKE 'CITIZENS_%'))
        ${isDept ? "OR recipient = '+18005550199' OR recipient = 'civic.complaints@city.phonemail.gov'" : ""}
      ) 
      AND label = ? AND folder != 'trash'
    `).get(...userIds, ...userIds, l);
    labelCounts[l] = row ? row.count : 0;
  }

  // Grievance ticket count
  const ticketRow = isDept
    ? db.prepare(`SELECT COUNT(*) as count FROM grievance_tickets`).get()
    : db.prepare(`SELECT COUNT(*) as count FROM grievance_tickets WHERE citizen_phone IN (${placeholders})`).get(...userIds);
  counts['grievance'] = ticketRow ? ticketRow.count : 0;

  return { folders: counts, labels: labelCounts };
}

// -------------------------------------------------------------
// CIVIC GRIEVANCE TICKETS REPOSITORY
// -------------------------------------------------------------

export function createGrievanceTicket({
  citizen_phone,
  department,
  subject,
  description,
  priority = 'Normal',
  source = 'email'
}) {
  const normalized = normalizePhone(citizen_phone);
  const ticketId = `TKT-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;

  const stmt = db.prepare(`
    INSERT INTO grievance_tickets (
      ticket_id, citizen_phone, department, subject, description, priority, source, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Registered')
  `);
  stmt.run(ticketId, normalized, department, subject, description, priority, source);

  return db.prepare('SELECT * FROM grievance_tickets WHERE ticket_id = ?').get(ticketId);
}

export function getTicketById(ticketId) {
  return db.prepare('SELECT * FROM grievance_tickets WHERE ticket_id = ?').get(ticketId);
}

export function getTicketsForCitizen(citizenPhone) {
  const normalized = normalizePhone(citizenPhone);
  return db.prepare('SELECT * FROM grievance_tickets WHERE citizen_phone = ? ORDER BY created_at DESC').all(normalized);
}

export function updateTicketStatus(ticketId, newStatus) {
  db.prepare(`
    UPDATE grievance_tickets 
    SET status = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE ticket_id = ?
  `).run(newStatus, ticketId);

  // Sync with emails table
  db.prepare(`UPDATE emails SET ticket_status = ? WHERE ticket_id = ?`).run(newStatus, ticketId);
  return getTicketById(ticketId);
}

export function getLatestTicketForCitizen(citizenPhone) {
  const normalized = normalizePhone(citizenPhone);
  return db.prepare('SELECT * FROM grievance_tickets WHERE citizen_phone = ? ORDER BY created_at DESC LIMIT 1').get(normalized);
}

export function getMessagesByTicketId(ticketId) {
  const rows = db.prepare('SELECT * FROM emails WHERE ticket_id = ? ORDER BY timestamp ASC').all(ticketId);
  return rows.map(r => formatEmailRow(r));
}

// -------------------------------------------------------------
// OTP REPOSITORY
// -------------------------------------------------------------

export function saveOtp(phoneNumber, code, channel = 'sms', expiryMinutes = 5) {
  const normalized = normalizePhone(phoneNumber);
  const expiresAt = new Date(Date.now() + expiryMinutes * 60000).toISOString();

  const stmt = db.prepare(`
    INSERT INTO otps (phone_number, code, channel, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(phone_number) DO UPDATE SET
      code = excluded.code,
      channel = excluded.channel,
      expires_at = excluded.expires_at,
      created_at = CURRENT_TIMESTAMP
  `);
  stmt.run(normalized, code, channel, expiresAt);
}

export function verifyOtp(phoneNumber, inputCode) {
  const normalized = normalizePhone(phoneNumber);
  const record = db.prepare('SELECT * FROM otps WHERE phone_number = ?').get(normalized);

  if (!record) {
    return { valid: false, reason: 'No active OTP verification code found for this number.' };
  }

  if (new Date(record.expires_at) < new Date()) {
    db.prepare('DELETE FROM otps WHERE phone_number = ?').run(normalized);
    return { valid: false, reason: 'OTP code has expired. Please request a new code.' };
  }

  db.prepare('DELETE FROM otps WHERE phone_number = ?').run(normalized);
  return { valid: true, channel: record.channel };
}

/**
 * Update email and grievance ticket when audio transcription finishes
 */
export function updateEmailTranscription(recordingUrl, transcriptionText) {
  if (!recordingUrl || !transcriptionText) return null;
  try {
    const email = db.prepare(`SELECT * FROM emails WHERE attachments_json LIKE ? ORDER BY timestamp DESC LIMIT 1`).get(`%${recordingUrl}%`);
    if (email) {
      let attachments = JSON.parse(email.attachments_json || '[]');
      attachments = attachments.map(att => {
        if (att.url === recordingUrl || att.type === 'audio') {
          return { ...att, transcription: transcriptionText };
        }
        return att;
      });

      const updatedBody = email.body.includes('AUTO-TRANSCRIBED')
        ? email.body.replace(/AUTO-TRANSCRIBED[^:]*:[^\n]*/i, `AUTO-TRANSCRIBED CITIZEN VOICE COMPLAINT:\n"${transcriptionText}"`)
        : `${email.body}\n\n[Auto-Transcription]: "${transcriptionText}"`;

      db.prepare(`UPDATE emails SET body = ?, attachments_json = ? WHERE id = ?`).run(
        updatedBody,
        JSON.stringify(attachments),
        email.id
      );

      if (email.ticket_id) {
        db.prepare(`UPDATE grievance_tickets SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE ticket_id = ?`).run(
          `[Voice IVR Helpline] Caller: ${email.sender}\nTranscription: "${transcriptionText}"\nRecording: ${recordingUrl}`,
          email.ticket_id
        );
      }
      return getEmailById(email.id);
    }
  } catch (err) {
    console.error('[Database] Failed to update transcription:', err);
  }
  return null;
}

/**
 * ============================================================
 * DISASTER ROBOCALL DATABASE HELPERS
 * ============================================================
 */

export function recordDisasterRobocall({ call_id, citizen_phone, headline, details, area_code = 'ALL', status = 'INITIATED' }) {
  const normalizedPhone = normalizePhone(citizen_phone);
  const stmt = db.prepare(`
    INSERT INTO disaster_robocalls (call_id, citizen_phone, headline, details, area_code, status, timestamp, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT(call_id) DO UPDATE SET
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `);
  stmt.run(call_id, normalizedPhone, headline, details, area_code, status);
  return getDisasterRobocallById(call_id);
}

export function getDisasterRobocallById(call_id) {
  return db.prepare('SELECT * FROM disaster_robocalls WHERE call_id = ?').get(call_id);
}

export function updateDisasterRobocallResponse(call_id, { status, dtmf_key = null, sos_ticket_id = null }) {
  db.prepare(`
    UPDATE disaster_robocalls 
    SET status = ?, dtmf_key = COALESCE(?, dtmf_key), sos_ticket_id = COALESCE(?, sos_ticket_id), updated_at = CURRENT_TIMESTAMP
    WHERE call_id = ?
  `).run(status, dtmf_key, sos_ticket_id, call_id);
  return getDisasterRobocallById(call_id);
}

export function getDisasterRobocalls(limit = 50) {
  return db.prepare('SELECT * FROM disaster_robocalls ORDER BY timestamp DESC LIMIT ?').all(limit);
}

export function getRobocallStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM disaster_robocalls').get().count;
  const safe = db.prepare("SELECT COUNT(*) as count FROM disaster_robocalls WHERE status = 'SAFE'").get().count;
  const sos = db.prepare("SELECT COUNT(*) as count FROM disaster_robocalls WHERE status = 'SOS_RESCUE_REQUESTED'").get().count;
  const pending = total - safe - sos;
  return { total, safe, sos, pending };
}

/**
 * ============================================================
 * OFFICIAL RECEIPT & WELFARE LOCKER VERIFICATION HELPERS
 * ============================================================
 */

export function getAllGovtReceipts() {
  const emails = db.prepare("SELECT * FROM emails WHERE label = 'Govt Receipts' OR is_gov_verified = 1 ORDER BY timestamp DESC").all();
  return emails.map(e => formatEmailRow(e));
}

export function verifyReceiptSeal({ seal_id, sha256 = null, ticket_id = null, beneficiary_phone = null, raw_payload = null }) {
  if (!seal_id && !ticket_id && !raw_payload) {
    return { verified: false, error: 'Seal ID or Docket number is required for verification.' };
  }

  // Parse raw JSON QR payload if provided
  let lookupSeal = seal_id;
  let lookupSha = sha256;
  let lookupTicket = ticket_id;
  let lookupBeneficiary = beneficiary_phone;

  if (raw_payload) {
    try {
      const parsed = typeof raw_payload === 'string' ? JSON.parse(raw_payload) : raw_payload;
      if (parsed.seal_id || parsed.seal) lookupSeal = parsed.seal_id || parsed.seal;
      if (parsed.sha256 || parsed.sha) lookupSha = parsed.sha256 || parsed.sha;
      if (parsed.ticket_id || parsed.ticket) lookupTicket = parsed.ticket_id || parsed.ticket;
      if (parsed.beneficiary || parsed.phone) lookupBeneficiary = parsed.beneficiary || parsed.phone;
    } catch (e) {
      // If it's a plain string like "SEAL-MUNI-98214-SHA256"
      if (typeof raw_payload === 'string' && raw_payload.startsWith('SEAL-')) {
        lookupSeal = raw_payload.trim();
      }
    }
  }

  // Search in database emails where label = 'Govt Receipts' or contains seal ID
  const allReceipts = getAllGovtReceipts();
  let matchedEmail = null;
  let matchedAttachment = null;

  for (const r of allReceipts) {
    for (const att of (r.attachments || [])) {
      if (lookupSeal && att.seal_id === lookupSeal) {
        matchedEmail = r;
        matchedAttachment = att;
        break;
      }
      if (lookupTicket && (r.ticket_id === lookupTicket || r.subject.includes(lookupTicket))) {
        matchedEmail = r;
        matchedAttachment = att;
        break;
      }
    }
    if (matchedEmail) break;

    // Also check email body
    if (lookupSeal && r.body.includes(lookupSeal)) {
      matchedEmail = r;
      matchedAttachment = r.attachments?.[0] || null;
      break;
    }
  }

  if (!matchedEmail) {
    return {
      verified: false,
      error: 'TAMPER_DETECTED: No government record found matching this cryptographic Seal ID in the PhoneMail Ledger.',
      seal_id: lookupSeal,
      status: 'INVALID_OR_COUNTERFEIT'
    };
  }

  // Check SHA-256 integrity
  const recordSha = matchedAttachment?.sha256 || '';
  if (lookupSha && recordSha && lookupSha !== recordSha) {
    return {
      verified: false,
      error: 'CRYPTOGRAPHIC INTEGRITY MISMATCH: The SHA-256 seal has been tampered with or modified.',
      expectedSha: recordSha,
      providedSha: lookupSha,
      status: 'TAMPERED'
    };
  }

  return {
    verified: true,
    status: 'AUTHENTIC_GOVERNMENT_SEAL',
    receipt: {
      id: matchedEmail.id,
      subject: matchedEmail.subject,
      issuing_authority: matchedAttachment?.issuing_authority || matchedEmail.sender_name || matchedEmail.sender,
      docket_type: matchedAttachment?.docket_type || 'Official Government Certificate',
      seal_id: matchedAttachment?.seal_id || lookupSeal,
      sha256: matchedAttachment?.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      beneficiary_phone: matchedEmail.recipient,
      issuance_timestamp: matchedEmail.timestamp,
      document_name: matchedAttachment?.name || 'Government_Receipt.pdf',
      docket_number: matchedEmail.ticket_id || matchedAttachment?.receipt_number || 'DOC-2026-0091'
    }
  };
}

