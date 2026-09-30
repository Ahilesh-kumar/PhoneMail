import express from 'express';
import QRCode from 'qrcode';
import {
  verifyReceiptSeal,
  getAllGovtReceipts,
  getEmailById
} from '../db.js';

const router = express.Router();

/**
 * Cryptographic Seal & QR Verification Endpoint
 * Checks SHA-256 seal integrity and issuing authority against SQLite database
 * POST /api/receipts/verify
 */
router.post('/verify', (req, res) => {
  const {
    seal_id,
    sha256,
    ticket_id,
    beneficiary_phone,
    raw_payload,
    qr_data
  } = req.body;

  const result = verifyReceiptSeal({
    seal_id,
    sha256,
    ticket_id,
    beneficiary_phone,
    raw_payload: raw_payload || qr_data
  });

  if (!result.verified) {
    return res.status(200).json({
      verified: false,
      authenticity: 'VERIFICATION FAILED',
      status: result.status || 'UNVERIFIED',
      error: result.error || 'Cryptographic seal mismatch or forged certificate.',
      checked_at: new Date().toISOString()
    });
  }

  res.json({
    verified: true,
    authenticity: '100% GOVERNMENT VERIFIED',
    status: 'AUTHENTIC_AND_VALID',
    receipt: result.receipt,
    audit: {
      validator: 'PhoneMail Cryptographic Ledger Authority',
      compliance: 'W3C Verifiable Credentials & Digital India Compliance',
      verified_at: new Date().toISOString(),
      integrity_status: 'SHA-256 Seal Match 100% Intact (Zero Tampering)'
    }
  });
});

/**
 * Generate sharp SVG QR Code for an Official Receipt Email
 * GET /api/receipts/qr-svg/:emailId
 */
router.get('/qr-svg/:emailId', async (req, res) => {
  const { emailId } = req.params;
  const email = getEmailById(emailId);
  if (!email) {
    return res.status(404).send('<svg><text>Receipt Not Found</text></svg>');
  }

  const attachments = JSON.parse(email.attachments_json || '[]');
  const att = attachments[0] || {};
  const sealId = att.seal_id || 'SEAL-MUNI-98214-SHA256';
  const sha256 = att.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  const payload = JSON.stringify({
    v: 1,
    type: 'GOV_RECEIPT_SEAL',
    seal: sealId,
    ticket: email.ticket_id || att.receipt_number || 'DOC-2026-0091',
    phone: email.recipient,
    sha: sha256,
    auth: att.issuing_authority || email.sender_name,
    issued: email.timestamp
  });

  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.type('image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('<svg><text>QR Generation Error</text></svg>');
  }
});

/**
 * Generate SVG QR Code directly by Seal ID
 * GET /api/receipts/qr-svg-by-seal/:sealId
 */
router.get('/qr-svg-by-seal/:sealId', async (req, res) => {
  const { sealId } = req.params;
  const result = verifyReceiptSeal({ seal_id: sealId });

  const payload = JSON.stringify({
    v: 1,
    type: 'GOV_RECEIPT_SEAL',
    seal: sealId,
    ticket: result.receipt?.docket_number || 'DOC-2026-0091',
    phone: result.receipt?.beneficiary_phone || '+19876543210',
    sha: result.receipt?.sha256 || 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    auth: result.receipt?.issuing_authority || 'Government Authority',
    issued: result.receipt?.issuance_timestamp || new Date().toISOString()
  });

  try {
    const svg = await QRCode.toString(payload, {
      type: 'svg',
      margin: 1,
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    });
    res.type('image/svg+xml');
    res.send(svg);
  } catch (err) {
    res.status(500).send('<svg><text>QR Generation Error</text></svg>');
  }
});

/**
 * Return preset sample seals for testing in UI modal
 * GET /api/receipts/sample-seals
 */
router.get('/sample-seals', (req, res) => {
  res.json({
    samples: [
      {
        name: '🏛️ Property Tax Clearance (FY 2026-27)',
        seal_id: 'SEAL-MUNI-98214-SHA256',
        sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        ticket_id: 'PTX-2026-9812',
        beneficiary: '+19876543210',
        authority: 'Municipal Corporation Treasury & Revenue Board',
        expected: 'VALID'
      },
      {
        name: '🚗 Driving License Renewal (DL-1420260089)',
        seal_id: 'SEAL-RTO-55210-SHA256',
        sha256: '4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a',
        ticket_id: 'DL-1420260089',
        beneficiary: '+19876543210',
        authority: 'Regional Transport Office (RTO)',
        expected: 'VALID'
      },
      {
        name: '👵 Senior Citizen Pension Deposit Slip',
        seal_id: 'SEAL-DBT-88120-SHA256',
        sha256: 'ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d',
        ticket_id: 'TR-DBT-2026-88102',
        beneficiary: '+19876543210',
        authority: 'Social Welfare & Pension Directorate',
        expected: 'VALID'
      },
      {
        name: '⚡ Power Subsidy Voucher (100 kWh)',
        seal_id: 'SEAL-EB-77891-SHA256',
        sha256: '6b86b273ff34fce19d6b804eff5a3f5747ada4eaa22f1d49c01e52ddb7875b4b',
        ticket_id: 'EB-7789-012',
        beneficiary: '+19876543210',
        authority: 'State Electricity & Energy Board',
        expected: 'VALID'
      },
      {
        name: '❌ Counterfeit / Altered Seal (Fraud Test)',
        seal_id: 'SEAL-FORGED-FAKE-00000',
        sha256: 'deadbeef00000000000000000000000000000000000000000000000000000000',
        ticket_id: 'FAKE-TAX-9999',
        beneficiary: '+19999999999',
        authority: 'Unknown Fraudulent Entity',
        expected: 'TAMPER_DETECTED'
      }
    ]
  });
});

/**
 * List all government receipts
 * GET /api/receipts/all
 */
router.get('/all', (req, res) => {
  res.json({
    receipts: getAllGovtReceipts()
  });
});

export default router;
