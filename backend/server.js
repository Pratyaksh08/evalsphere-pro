// EvalSphere Assessment Platform - Backend Engine
// Technologies: Express.js, Real SMS (Fast2SMS / Twilio), Real Email (Nodemailer), GCC, SQLite WebAssembly
require('dotenv').config();
const express = require('express');
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const initSqlJs = require('sql.js');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50kb' }));

// Serve static frontend files from ../frontend directory
const frontendDir = path.join(__dirname, '../frontend');
if (fs.existsSync(frontendDir)) {
  app.use(express.static(frontendDir));
}

// -----------------------------------------------------------------------------
// -----------------------------------------------------------------------------
// REAL EMAIL TRANSPORTER CONFIGURATION (GMAIL / SMTP)
// -----------------------------------------------------------------------------
function getMailTransporter() {
  const gmailUser = (process.env.GMAIL_USER || '').trim();
  const gmailPass = (process.env.GMAIL_APP_PASS || '').trim().replace(/\s+/g, '');

  if (gmailUser && gmailPass) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: gmailUser,
        pass: gmailPass
      }
    });
  }

  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();

  if (smtpHost && smtpUser && smtpPass) {
    return nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true' || process.env.SMTP_PORT === '465',
      auth: {
        user: smtpUser,
        pass: smtpPass
      }
    });
  }

  return null;
}

// -----------------------------------------------------------------------------
// USER DATABASE & ACTIVE OTP STORE
// -----------------------------------------------------------------------------
const USERS = [
  {
    id: 'usr_demo_1',
    name: 'Alex Morgan',
    email: 'alex@evalsphere.com',
    mobile: '9876543210',
    college: 'Apex Institute of Technology',
    branch: 'Computer Science & Engineering',
    registeredAt: new Date().toISOString()
  }
];

const OTP_STORE = new Map(); // identifier (email or 10-digit mobile) -> { otp, expiresAt, channel, name, college, branch }
const SESSIONS = new Map();  // token -> userId

function generateSixDigitOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// -----------------------------------------------------------------------------
// REAL SMS & EMAIL DISPATCH DISPATCHER
// -----------------------------------------------------------------------------
async function sendRealSMS(mobile, otp) {
  const cleanMobile = mobile.replace(/\D/g, '').slice(-10);

  // 1. Fast2SMS Integration (Instant Indian SMS Gateway)
  const f2sKey = process.env.FAST2SMS_API_KEY ? process.env.FAST2SMS_API_KEY.trim() : '';
  if (f2sKey) {
    try {
      const response = await fetch('https://www.fast2sms.com/dev/bulkV2', {
        method: 'POST',
        headers: {
          'authorization': f2sKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          route: 'otp',
          variables_values: otp,
          numbers: cleanMobile
        })
      });
      const data = await response.json();
      if (data.return) {
        console.log(`✅ [REAL SMS DELIVERED via Fast2SMS] Sent to +91-${cleanMobile}`);
        return { success: true, provider: 'Fast2SMS' };
      } else {
        console.warn(`⚠️ [Fast2SMS Gateway Status]:`, data.message || data);
        return { success: false, provider: 'Fast2SMS', message: data.message };
      }
    } catch (err) {
      console.error(`⚠️ Fast2SMS Error:`, err.message);
      return { success: false, provider: 'Fast2SMS', error: err.message };
    }
  }

  // 2. Twilio SMS Integration (Global SMS Gateway)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER) {
    try {
      const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const params = new URLSearchParams();
      params.append('To', `+91${cleanMobile}`);
      params.append('From', process.env.TWILIO_PHONE_NUMBER);
      params.append('Body', `Your EvalSphere verification code is: ${otp}. Valid for 5 minutes.`);

      const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });
      const data = await response.json();
      if (data.sid) {
        console.log(`✅ [REAL SMS DELIVERED via Twilio] Sent to +91-${cleanMobile} (SID: ${data.sid})`);
        return { success: true, provider: 'Twilio' };
      } else {
        console.warn(`⚠️ Twilio response:`, data.message);
      }
    } catch (err) {
      console.error(`⚠️ Twilio Error:`, err.message);
    }
  }

  return { success: false, reason: 'No active SMS Gateway API key configured in .env' };
}

async function sendRealEmail(email, otp, name) {
  const recipientName = name || 'Student';
  const transporter = getMailTransporter();
  if (!transporter) {
    return { success: false, reason: 'No SMTP / Gmail credentials configured in backend/.env' };
  }

  try {
    const sender = process.env.GMAIL_USER || process.env.SMTP_USER || 'no-reply@evalsphere.com';
    await transporter.sendMail({
      from: `"EvalSphere PRO" <${sender}>`,
      to: email,
      subject: `[EvalSphere] ${otp} is your Login Verification Code`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 24px; background-color: #07090e; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
          <table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="max-width: 520px; margin: 0 auto; background: linear-gradient(180deg, #111827 0%, #0b0f17 100%); border-radius: 16px; border: 1px solid #1e293b; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
            <tr>
              <td style="padding: 28px 32px 12px; text-align: center; border-bottom: 1px solid #1e293b;">
                <div style="display: inline-flex; align-items: center; justify-content: center; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 10px 18px;">
                  <span style="font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">Eval<span style="color: #38bdf8;">Sphere</span></span>
                  <span style="background: linear-gradient(135deg, #3b82f6, #06b6d4); color: #ffffff; font-size: 10px; font-weight: 800; padding: 2px 7px; border-radius: 6px; margin-left: 8px;">PRO</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding: 32px 32px 16px;">
                <h2 style="margin: 0 0 12px; font-size: 20px; font-weight: 700; color: #f8fafc; text-align: center;">Login Verification Code</h2>
                <p style="margin: 0 0 20px; font-size: 14px; color: #94a3b8; line-height: 1.6; text-align: center;">
                  Hello <strong>${recipientName}</strong>, use the 6-digit One-Time Password (OTP) below to sign in to your EvalSphere Assessment Portal:
                </p>
                
                <div style="background: #07090e; border: 2px dashed #3b82f6; border-radius: 12px; padding: 18px 24px; text-align: center; margin: 24px 0;">
                  <div style="font-family: 'Fira Code', 'Courier New', Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 10px; color: #38bdf8; text-indent: 10px;">
                    ${otp}
                  </div>
                  <div style="margin-top: 8px; font-size: 12px; color: #64748b; font-weight: 600;">
                    ⏰ Valid for 5 minutes • Do not share with anyone
                  </div>
                </div>

                <p style="margin: 0 0 12px; font-size: 13px; color: #94a3b8; line-height: 1.5;">
                  🔒 <strong>Security Tip:</strong> If you did not request this verification code, please ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding: 16px 32px 24px; background: #07090e; border-top: 1px solid #1e293b; text-align: center;">
                <p style="margin: 0; font-size: 12px; color: #64748b;">
                  EvalSphere PRO — Student Assessment & Skill Evaluation Platform<br>
                  This is an automated message.
                </p>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `
    });
    console.log(`✅ [REAL EMAIL DELIVERED] Successfully sent verification OTP to ${email}`);
    return { success: true };
  } catch (err) {
    console.error(`⚠️ Email Delivery Error to ${email}:`, err.message);
    return { success: false, error: err.message };
  }
}

// -----------------------------------------------------------------------------
// AUTHENTICATION API ENDPOINTS (EMAIL OR MOBILE OTP)
// -----------------------------------------------------------------------------

// 1. Send OTP (User chooses Email OR Mobile)
app.post('/api/auth/send-otp', async (req, res) => {
  const { channel, email, mobile, name, college, branch } = req.body || {};

  const cleanChannel = channel === 'mobile' ? 'mobile' : 'email';
  let identifier = '';

  if (cleanChannel === 'email') {
    identifier = String(email || '').trim().toLowerCase();
    if (!identifier || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
  } else {
    identifier = String(mobile || '').trim().replace(/\D/g, '').slice(-10);
    if (identifier.length < 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number.' });
    }
  }

  // Generate 6-digit secure OTP
  const otp = generateSixDigitOTP();
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 mins

  const otpRecord = {
    otp,
    expiresAt,
    channel: cleanChannel,
    identifier,
    name: name ? String(name).trim() : '',
    email: cleanChannel === 'email' ? identifier : (email ? String(email).trim().toLowerCase() : ''),
    mobile: cleanChannel === 'mobile' ? identifier : (mobile ? String(mobile).trim().replace(/\D/g, '') : ''),
    college: college ? String(college).trim() : '',
    branch: branch ? String(branch).trim() : ''
  };

  OTP_STORE.set(identifier, otpRecord);

  const smsConfigured = !!(process.env.FAST2SMS_API_KEY || (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN));
  const emailConfigured = !!getMailTransporter();

  // Clear & Prominent Terminal Console Log
  console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
  console.log(`║             🔐 EVALSPHERE 6-DIGIT OTP DISPATCH               ║`);
  console.log(`╠══════════════════════════════════════════════════════════════╣`);
  console.log(`║ Channel:     ${(cleanChannel.toUpperCase()).padEnd(47)} ║`);
  console.log(`║ Destination: ${(cleanChannel === 'email' ? identifier : '+91-' + identifier).padEnd(47)} ║`);
  console.log(`║ 6-DIGIT OTP: >> ${otp} <<                                   ║`);
  console.log(`║ Expiry:      5 Minutes                                       ║`);
  if (cleanChannel === 'email') {
    if (emailConfigured) {
      console.log(`║ 📧 Real Email Gateway: Configured & Sending to Inbox         ║`);
    } else {
      console.log(`║ ℹ️  Real Email Gateway: Set GMAIL_USER & GMAIL_APP_PASS      ║`);
      console.log(`║    in backend/.env to send real OTP emails directly.         ║`);
    }
  } else if (cleanChannel === 'mobile' && !smsConfigured) {
    console.log(`║ ℹ️  Real SMS Gateway: Not configured in backend/.env         ║`);
    console.log(`║    Add FAST2SMS_API_KEY in backend/.env to send real SMS     ║`);
  }
  console.log(`╚══════════════════════════════════════════════════════════════╝\n`);

  // Attempt real delivery
  let realDelivery = null;
  if (cleanChannel === 'mobile') {
    realDelivery = await sendRealSMS(identifier, otp);
  } else {
    realDelivery = await sendRealEmail(identifier, otp, otpRecord.name);
  }

  const destLabel = cleanChannel === 'email' ? identifier : `+91-${identifier}`;

  res.json({
    success: true,
    channel: cleanChannel,
    identifier,
    message: `Verification code sent to ${destLabel}.`,
    smsConfigured,
    emailConfigured,
    realDeliveryStatus: realDelivery,
    devOtp: (cleanChannel === 'email' && !emailConfigured) || (cleanChannel === 'mobile' && !smsConfigured) ? otp : undefined,
    expiresInSeconds: 300
  });
});

// 2. Verify OTP & Log In / Register
app.post('/api/auth/verify-otp', (req, res) => {
  const { channel, identifier, otp, name, college, branch } = req.body || {};

  const cleanChannel = channel === 'mobile' ? 'mobile' : 'email';
  let cleanId = '';

  if (cleanChannel === 'email') {
    cleanId = String(identifier || '').trim().toLowerCase();
  } else {
    cleanId = String(identifier || '').trim().replace(/\D/g, '').slice(-10);
  }

  const cleanOtp = String(otp || '').trim();

  if (!cleanId || !cleanOtp) {
    return res.status(400).json({ error: 'Verification target and OTP code are required.' });
  }

  const record = OTP_STORE.get(cleanId);

  if (!record) {
    return res.status(400).json({ error: 'No active verification code found for this destination. Please click "Resend OTP".' });
  }

  if (Date.now() > record.expiresAt) {
    OTP_STORE.delete(cleanId);
    return res.status(400).json({ error: 'The verification code has expired. Please request a new OTP.' });
  }

  if (record.otp !== cleanOtp) {
    return res.status(400).json({ error: 'Invalid verification code. Please check your phone/email.' });
  }

  // OTP verified! Clear record
  OTP_STORE.delete(cleanId);

  // Find or create user
  let user = USERS.find(u => 
    (cleanChannel === 'email' && u.email.toLowerCase() === cleanId) ||
    (cleanChannel === 'mobile' && u.mobile === cleanId)
  );

  if (!user) {
    user = {
      id: 'usr_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
      name: name || record.name || (cleanChannel === 'email' ? cleanId.split('@')[0] : `Student (${cleanId.slice(-4)})`),
      email: record.email || (cleanChannel === 'email' ? cleanId : `${cleanId}@student.portal`),
      mobile: record.mobile || (cleanChannel === 'mobile' ? cleanId : '9876543210'),
      college: college || record.college || 'Engineering & Technology',
      branch: branch || record.branch || 'Computer Science & Engineering',
      registeredAt: new Date().toISOString()
    };
    USERS.push(user);
    console.log(`✨ [STUDENT VERIFIED & SAVED] ${user.name} (${cleanChannel}: ${cleanId})`);
  } else {
    if (name) user.name = name;
    if (college) user.college = college;
    if (branch) user.branch = branch;
  }

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  SESSIONS.set(token, user.id);

  res.json({
    success: true,
    message: `Verification successful! Welcome, ${user.name}.`,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      college: user.college,
      branch: user.branch
    },
    token
  });
});

// 2.1 Quick Direct Login (Persistent Device Access / Bypass OTP)
app.post('/api/auth/quick-login', (req, res) => {
  const { email, mobile, name } = req.body || {};
  let user = null;

  if (email) {
    user = USERS.find(u => u.email.toLowerCase() === String(email).trim().toLowerCase());
  } else if (mobile) {
    const cleanMobile = String(mobile).replace(/\D/g, '').slice(-10);
    user = USERS.find(u => u.mobile === cleanMobile);
  }

  if (!user) {
    user = USERS[0]; // fallback default registered candidate
  }

  const token = 'tok_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
  SESSIONS.set(token, user.id);

  console.log(`⚡ [DIRECT ACCESS] ${user.name} logged in via persistent session token`);

  res.json({
    success: true,
    message: `Welcome back, ${user.name}!`,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      college: user.college,
      branch: user.branch
    },
    token
  });
});

// 3. Current User Profile
app.get('/api/auth/me', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;

  if (!token || !SESSIONS.has(token)) {
    return res.status(401).json({ error: 'Not authenticated or session expired.' });
  }

  const userId = SESSIONS.get(token);
  const user = USERS.find(u => u.id === userId);

  if (!user) {
    return res.status(404).json({ error: 'User account not found.' });
  }

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      college: user.college,
      branch: user.branch
    }
  });
});

// 4. Logout
app.post('/api/auth/logout', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader ? authHeader.replace(/^Bearer\s+/i, '') : null;
  if (token) {
    SESSIONS.delete(token);
  }
  res.json({ success: true, message: 'Signed out successfully.' });
});

// -----------------------------------------------------------------------------
// PROBLEM REPOSITORY (Backend hidden test cases and verification datasets)
// -----------------------------------------------------------------------------

const C_PROBLEMS = {
  c1: {
    id: 'c1',
    title: 'Sum of Two Integers',
    statement: 'Write a C program to calculate the sum of two integers read from standard input.',
    input: 'Two space-separated integers a and b.',
    output: 'A single integer representing a + b.',
    constraints: '-10^6 <= a, b <= 10^6',
    sampleIn: '3 4',
    sampleOut: '7',
    starter: '#include <stdio.h>\n\nint main() {\n    int a, b;\n    if (scanf("%d %d", &a, &b) == 2) {\n        printf("%d\\n", a + b);\n    }\n    return 0;\n}\n',
    tests: [
      { input: '3 4\n', expected: '7' },
      { input: '-5 10\n', expected: '5' },
      { input: '0 0\n', expected: '0' },
      { input: '1000000 999999\n', expected: '1999999' },
      { input: '-50 -50\n', expected: '-100' }
    ]
  },
  c2: {
    id: 'c2',
    title: 'Check Palindrome Number',
    statement: 'Write a C program that checks whether a given positive integer is a palindrome (reads the same backwards and forwards). Output "YES" if it is a palindrome, otherwise output "NO".',
    input: 'A single integer n (0 <= n <= 10^9).',
    output: '"YES" or "NO" (without quotes).',
    constraints: '0 <= n <= 10^9',
    sampleIn: '121',
    sampleOut: 'YES',
    starter: '#include <stdio.h>\n\nint main() {\n    long long n, original, reversed = 0, rem;\n    if (scanf("%lld", &n) == 1) {\n        original = n;\n        while (n > 0) {\n            rem = n % 10;\n            reversed = reversed * 10 + rem;\n            n /= 10;\n        }\n        if (original == reversed) {\n            printf("YES\\n");\n        } else {\n            printf("NO\\n");\n        }\n    }\n    return 0;\n}\n',
    tests: [
      { input: '121\n', expected: 'YES' },
      { input: '123\n', expected: 'NO' },
      { input: '7\n', expected: 'YES' },
      { input: '1234321\n', expected: 'YES' },
      { input: '1000\n', expected: 'NO' }
    ]
  },
  c3: {
    id: 'c3',
    title: 'Find Maximum in Array',
    statement: 'Given an array of N integers, find and print the maximum value in the array.',
    input: 'First line contains integer N (1 <= N <= 100). Second line contains N space-separated integers.',
    output: 'A single integer representing the maximum value.',
    constraints: '1 <= N <= 100, -1000 <= element <= 1000',
    sampleIn: '5\n12 45 2 99 31',
    sampleOut: '99',
    starter: '#include <stdio.h>\n\nint main() {\n    int n;\n    if (scanf("%d", &n) == 1 && n > 0) {\n        int maxVal, x;\n        scanf("%d", &maxVal);\n        for (int i = 1; i < n; i++) {\n            scanf("%d", &x);\n            if (x > maxVal) maxVal = x;\n        }\n        printf("%d\\n", maxVal);\n    }\n    return 0;\n}\n',
    tests: [
      { input: '5\n12 45 2 99 31\n', expected: '99' },
      { input: '3\n-10 -5 -20\n', expected: '-5' },
      { input: '1\n42\n', expected: '42' },
      { input: '6\n100 200 50 300 150 250\n', expected: '300' }
    ]
  },
  c4: {
    id: 'c4',
    title: 'Factorial of a Number',
    statement: 'Write a C program to calculate the factorial of a non-negative integer N (N <= 15).',
    input: 'A single integer N (0 <= N <= 15).',
    output: 'A single integer representing N!',
    constraints: '0 <= N <= 15',
    sampleIn: '5',
    sampleOut: '120',
    starter: '#include <stdio.h>\n\nint main() {\n    int n;\n    if (scanf("%d", &n) == 1) {\n        long long fact = 1;\n        for (int i = 1; i <= n; i++) {\n            fact *= i;\n        }\n        printf("%lld\\n", fact);\n    }\n    return 0;\n}\n',
    tests: [
      { input: '5\n', expected: '120' },
      { input: '0\n', expected: '1' },
      { input: '1\n', expected: '1' },
      { input: '7\n', expected: '5040' },
      { input: '10\n', expected: '3628800' }
    ]
  }
};

const SQL_PROBLEMS = {
  s1: {
    id: 's1',
    title: 'High Scorers Filter',
    statement: 'Retrieve the name and marks of all students from the "students" table whose marks are strictly greater than 80, ordered by marks descending.',
    schema: 'CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, department TEXT, marks INTEGER);',
    sample: {
      columns: ['id', 'name', 'department', 'marks'],
      rows: [
        [1, 'Asha', 'CSE', 92],
        [2, 'Ravi', 'ECE', 78],
        [3, 'Meena', 'CSE', 85],
        [4, 'Karan', 'MECH', 64],
        [5, 'Divya', 'ECE', 81],
        [6, 'Arjun', 'CSE', 80]
      ]
    },
    starter: '-- Retrieve name and marks for students with marks > 80\nSELECT name, marks\nFROM students\nWHERE marks > 80\nORDER BY marks DESC;',
    expected: 'SELECT name, marks FROM students WHERE marks > 80 ORDER BY marks DESC;',
    datasets: [
      "INSERT INTO students VALUES (1,'Asha','CSE',92),(2,'Ravi','ECE',78),(3,'Meena','CSE',85),(4,'Karan','MECH',64),(5,'Divya','ECE',81),(6,'Arjun','CSE',80);",
      "INSERT INTO students VALUES (1,'Neha','IT',99),(2,'Sam','IT',80),(3,'Lee','CSE',81),(4,'Omar','ECE',45),(5,'Priya','AI',95);"
    ]
  },
  s2: {
    id: 's2',
    title: 'Department Average Salary',
    statement: 'Write a query to display the department and average salary of employees in each department. Name the average salary column "avg_salary" and round it or display it ordered by department alphabetically.',
    schema: 'CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT, department TEXT, salary INTEGER);',
    sample: {
      columns: ['id', 'name', 'department', 'salary'],
      rows: [
        [101, 'Aditi', 'Engineering', 85000],
        [102, 'Rohan', 'Engineering', 95000],
        [103, 'Sanya', 'Marketing', 60000],
        [104, 'Vikram', 'Marketing', 70000],
        [105, 'Kavya', 'Sales', 55000]
      ]
    },
    starter: '-- Calculate average salary per department\nSELECT department, AVG(salary) AS avg_salary\nFROM employees\nGROUP BY department\nORDER BY department;',
    expected: 'SELECT department, AVG(salary) AS avg_salary FROM employees GROUP BY department ORDER BY department;',
    datasets: [
      "INSERT INTO employees VALUES (101,'Aditi','Engineering',85000),(102,'Rohan','Engineering',95000),(103,'Sanya','Marketing',60000),(104,'Vikram','Marketing',70000),(105,'Kavya','Sales',55000);",
      "INSERT INTO employees VALUES (101,'Alex','DevOps',75000),(102,'Bob','DevOps',85000),(103,'Carol','HR',50000),(104,'Dave','HR',52000);"
    ]
  },
  s3: {
    id: 's3',
    title: 'Department Headcount',
    statement: 'Write an SQL query to list each department along with the total count of students enrolled in that department. Order the result by total count descending.',
    schema: 'CREATE TABLE students (id INTEGER PRIMARY KEY, name TEXT, department TEXT, marks INTEGER);',
    sample: {
      columns: ['id', 'name', 'department', 'marks'],
      rows: [
        [1, 'Asha', 'CSE', 92],
        [2, 'Ravi', 'ECE', 78],
        [3, 'Meena', 'CSE', 85],
        [4, 'Karan', 'MECH', 64],
        [5, 'Divya', 'ECE', 81],
        [6, 'Arjun', 'CSE', 80]
      ]
    },
    starter: '-- Count number of students per department\nSELECT department, COUNT(*) AS student_count\nFROM students\nGROUP BY department\nORDER BY student_count DESC;',
    expected: 'SELECT department, COUNT(*) AS student_count FROM students GROUP BY department ORDER BY student_count DESC;',
    datasets: [
      "INSERT INTO students VALUES (1,'Asha','CSE',92),(2,'Ravi','ECE',78),(3,'Meena','CSE',85),(4,'Karan','MECH',64),(5,'Divya','ECE',81),(6,'Arjun','CSE',80);",
      "INSERT INTO students VALUES (1,'Tara','BioTech',88),(2,'Dev','BioTech',74),(3,'Leo','Design',90),(4,'Zara','Design',92),(5,'Ben','Design',65);"
    ]
  }
};

// -----------------------------------------------------------------------------
// SQL ENGINE INITIALIZATION (sql.js WebAssembly)
// -----------------------------------------------------------------------------
let SQLP = null;
initSqlJs()
  .then(SQL => {
    SQLP = SQL;
    console.log('✅ SQLite WebAssembly Engine initialized successfully');
  })
  .catch(err => {
    console.error('❌ Failed to initialize sql.js:', err);
  });

const norm = r =>
  r
    ? JSON.stringify({
        c: r.columns.map(x => String(x).toLowerCase()),
        v: r.values.map(row => JSON.stringify(row)).sort()
      })
    : 'EMPTY';

// -----------------------------------------------------------------------------
// HELPER FOR PROCESS EXECUTION
// -----------------------------------------------------------------------------
const MAX_CODE_LENGTH = 15000;
const EXEC_TIMEOUT = 3000;
const COMPILE_TIMEOUT = 12000;

function runFile(file, args, opts) {
  return new Promise(resolve => {
    execFile(file, args, opts, (err, stdout, stderr) => {
      resolve({ err, stdout, stderr });
    });
  });
}

// -----------------------------------------------------------------------------
// API ROUTES
// -----------------------------------------------------------------------------

// Health Check & Server Status
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    platform: 'EvalSphere Assessment Engine',
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    sqlEngineReady: !!SQLP,
    registeredUsersCount: USERS.length,
    smsConfigured: !!(process.env.FAST2SMS_API_KEY || process.env.TWILIO_ACCOUNT_SID),
    emailConfigured: !!(process.env.GMAIL_USER || process.env.SMTP_USER),
    nodeVersion: process.version,
    os: `${os.type()} ${os.release()}`
  });
});

// Get Problem Catalog & Metadata
app.get('/api/problems', (req, res) => {
  const cList = Object.values(C_PROBLEMS).map(p => ({
    id: p.id,
    title: p.title,
    statement: p.statement,
    input: p.input,
    output: p.output,
    constraints: p.constraints,
    sampleIn: p.sampleIn,
    sampleOut: p.sampleOut,
    starter: p.starter
  }));

  const sqlList = Object.values(SQL_PROBLEMS).map(p => ({
    id: p.id,
    title: p.title,
    statement: p.statement,
    schema: p.schema,
    sample: p.sample,
    starter: p.starter
  }));

  res.json({ c: cList, sql: sqlList });
});

// Execute C Code with GCC
app.post('/api/run-c', async (req, res) => {
  const { code, problemId } = req.body || {};
  const problem = C_PROBLEMS[problemId] || C_PROBLEMS.c1;

  if (typeof code !== 'string') {
    return res.status(400).json({ error: 'Code content must be a valid string.' });
  }
  if (code.length > MAX_CODE_LENGTH) {
    return res.status(400).json({ error: `Code exceeds maximum allowed size (${MAX_CODE_LENGTH} chars).` });
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalsphere-c-'));
  const src = path.join(dir, 'main.c');
  const exe = path.join(dir, process.platform === 'win32' ? 'main.exe' : 'main');

  try {
    fs.writeFileSync(src, code, 'utf8');

    // Compile with GCC
    const compileResult = await runFile('gcc', [src, '-o', exe, '-lm', '-O2'], {
      timeout: COMPILE_TIMEOUT,
      maxBuffer: 1024 * 1024
    });

    if (compileResult.err) {
      if (compileResult.err.code === 'ENOENT') {
        return res.json({
          compileError: 'GCC compiler was not detected on the system. Please ensure GCC (MinGW / MSYS2 / build-essential) is installed and in PATH.'
        });
      }
      const cleanedErr = (compileResult.stderr || compileResult.err.message).replace(
        new RegExp(dir.replace(/\\/g, '\\\\'), 'g'),
        ''
      );
      return res.json({ compileError: cleanedErr });
    }

    // Execute compiled binary against test cases
    const tests = [];
    for (let i = 0; i < problem.tests.length; i++) {
      const t = problem.tests[i];
      const execResult = await new Promise(resolve => {
        const child = execFile(
          exe,
          [],
          { timeout: EXEC_TIMEOUT, maxBuffer: 64 * 1024, cwd: dir },
          (err, stdout, stderr) => resolve({ err, stdout, stderr })
        );
        child.stdin.on('error', () => {});
        child.stdin.end(t.input);
      });

      let runtimeError = '';
      if (execResult.err) {
        if (execResult.err.killed) {
          runtimeError = `Time Limit Exceeded (${EXEC_TIMEOUT / 1000}s). Check for infinite loops or recursion.`;
        } else if (execResult.err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
          runtimeError = 'Standard output size limit exceeded (64 KB).';
        } else {
          runtimeError = `Runtime Error: ${execResult.stderr || execResult.err.message || 'Non-zero exit'}`;
        }
      }

      const actual = (execResult.stdout || '').trim();
      const expected = t.expected.trim();
      const passed = !runtimeError && actual === expected;

      tests.push({
        testIndex: i + 1,
        input: t.input.trim(),
        expected,
        actual,
        runtimeError,
        passed,
        isHidden: i > 0
      });
    }

    res.json({ tests, success: true });
  } catch (err) {
    res.json({ compileError: 'Server Execution Error: ' + err.message });
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}
  }
});

// Execute SQL Query with in-memory WebAssembly SQLite
app.post('/api/run-sql', (req, res) => {
  const { query, problemId } = req.body || {};
  const problem = SQL_PROBLEMS[problemId] || SQL_PROBLEMS.s1;

  if (typeof query !== 'string') {
    return res.status(400).json({ error: 'Query must be a valid string.' });
  }
  if (query.trim().length === 0) {
    return res.json({ sqlError: 'Query is empty. Please enter an SQL query.' });
  }
  if (query.length > 5000) {
    return res.status(400).json({ error: 'Query is too long (maximum 5000 characters).' });
  }
  if (!SQLP) {
    return res.status(503).json({ error: 'SQL engine is still initializing. Please retry in a few moments.' });
  }

  // Security barrier: only allow read/query statements for safety in assessment
  if (!/^\s*(SELECT|WITH)\b/i.test(query)) {
    return res.json({
      sqlError: 'Access Restricted: Only SELECT and WITH (read-only query) statements are allowed in this assessment.'
    });
  }

  const tests = [];
  let table = null;
  let sqlError = '';

  problem.datasets.forEach((dataSql, idx) => {
    let db = null;
    try {
      db = new SQLP.Database();
      db.run(problem.schema);
      db.run(dataSql);

      const expectedRes = db.exec(problem.expected)[0];
      let userRes = null;

      try {
        const resultList = db.exec(query);
        userRes = resultList[0] || null;
      } catch (execErr) {
        sqlError = execErr.message;
      }

      if (idx === 0 && userRes) {
        table = userRes;
      }

      const passed = !sqlError && norm(userRes) === norm(expectedRes);

      tests.push({
        name: idx === 0 ? 'Sample Dataset' : `Hidden Dataset ${idx}`,
        passed,
        sqlError: sqlError || undefined
      });
    } catch (dbErr) {
      sqlError = dbErr.message;
      tests.push({
        name: `Dataset ${idx + 1}`,
        passed: false,
        sqlError: dbErr.message
      });
    } finally {
      if (db) {
        try {
          db.close();
        } catch (_) {}
      }
    }
  });

  res.json({
    table,
    sqlError,
    tests,
    success: !sqlError
  });
});

// -----------------------------------------------------------------------------
// AI ASSISTANT / CHATBOT ENGINE (EXAM GUIDE & CODING COPILOT)
// -----------------------------------------------------------------------------
app.post('/api/ai-assistant', (req, res) => {
  const { message = '' } = req.body || {};
  const query = message.trim();
  const q = query.toLowerCase();

  const numMatch = q.match(/^(?:option|choice|#|select|item)?\s*([1-8])(?:\.|\)|\s|:|-|$)/i) || q.match(/^([1-8])$/);
  const isDirectNum = (numMatch && (q.length <= 15 || /^(?:option|choice|#|select|item)\s*[1-8]/i.test(q)));
  const selectedNum = isDirectNum ? numMatch[1] : null;

  let reply = '';

  // Option 1: Attend Exam
  if (selectedNum === '1') {
    reply = `### 📝 **Guide: How to Attend Assessments & Exam Rules**

Here is your complete step-by-step examination walkthrough:

1. **Browse Subjects**:
   - Go to **"All Subjects"** from the top navbar or click any subject card on your Dashboard (C Programming, DBMS, DSA, OOPs, Quantitative Aptitude).

2. **Launch Objective Assessment**:
   - Click **"Launch Objective Assessment"** on the chosen module.
   - The test loads multiple-choice questions with a single correct answer.

3. **Active Countdown Timer**:
   - An active countdown timer is displayed in the top navigation bar.
   - Keep track of your time. If time reaches **00:00**, your test is automatically submitted.

4. **Answering & Navigation**:
   - Select your response by clicking radio options **(A, B, C, or D)**.
   - Click **"Next Question →"** or **"← Previous"** to move across questions.

5. **Submission & Instant Detailed Scorecard**:
   - When finished, click **"Submit Final Assessment"**.
   - Your scorecard will instantly display:
     - 🎯 **Accuracy Percentage** and total correct/incorrect count
     - ⏱️ **Time Taken**
     - 💡 **Detailed Answer Review** with step-by-step verified explanations for each question!`;
  } else if (selectedNum === '2') {
    reply = `### 💻 **Guide: How to Use the C Compiler Arena**

The C Compiler Arena evaluates your programming skills using a live **GCC Compiler**:

1. **Open the Arena**:
   - Click **"C Compiler Arena"** in the top navigation bar.

2. **Select Coding Problem**:
   - Choose a problem from the left sidebar (e.g., Matrix Transpose, Binary Search, String Reversal, Dynamic Array).

3. **Write Your C Solution**:
   - Write standard C in the built-in code editor. Standard libraries (\`<stdio.h>\`, \`<stdlib.h>\`, \`<string.h>\`, \`<math.h>\`) are fully supported.
   - Example:
\`\`\`c
#include <stdio.h>

int main() {
    int n;
    if (scanf("%d", &n) == 1) {
        printf("%d\\n", n * 2);
    }
    return 0;
}
\`\`\`

4. **Compile & Run Test Cases**:
   - Click **"▶ Run Code"** to execute your program against automated test datasets.
   - Check **Program Output** and **Compilation Errors** below the editor.

5. **Submit Solution**:
   - Once all test cases pass, click **"✔ Submit Solution"** to record your benchmark!`;
  } else if (selectedNum === '3') {
    reply = `### ⛁ **Guide: How to Use SQL Studio**

SQL Studio runs against an in-memory **SQLite WebAssembly Engine**:

1. **Launch Studio**:
   - Click **"SQL Studio"** in the top navigation bar or from the DBMS module card.

2. **Inspect Database Schema**:
   - Problem statement shows the active table schema (e.g., \`employees\`, \`departments\`, \`orders\`).

3. **Write SQL Query**:
   - Enter your standard SQL query in the editor.
   - Example:
\`\`\`sql
SELECT department, COUNT(*) AS total_staff, AVG(salary) AS avg_sal
FROM employees
GROUP BY department
HAVING AVG(salary) > 60000
ORDER BY avg_sal DESC;
\`\`\`

4. **Execute & Test**:
   - Click **"▶ Execute SQL Query"**.
   - Your query result table is rendered instantly and validated against reference datasets.

5. **Submit**:
   - Click **"✔ Submit Solution"** once passing all test datasets.`;
  } else if (selectedNum === '4') {
    reply = `### 📊 **Guide: Solving Quantitative Aptitude Challenges**

Tips and formulas for mastering Quantitative Aptitude:

1. **Time & Work**:
   - If Person A completes a task in $x$ days, their 1-day work rate is $\\frac{1}{x}$.
   - Combined rate of A and B = $\\frac{1}{A} + \\frac{1}{B} = \\frac{A + B}{AB}$. Time taken = $\\frac{AB}{A + B}$ days.

2. **Percentages & Profit/Loss**:
   - Percentage Increase/Decrease = $\\frac{|\\text{New} - \\text{Old}|}{\\text{Old}} \\times 100\\%$.
   - $\\text{Profit}\\% = \\frac{\\text{SP} - \\text{CP}}{\\text{CP}} \\times 100\\%$.

3. **Speed, Distance & Time**:
   - $\\text{Speed} = \\frac{\\text{Distance}}{\\text{Time}}$, $\\text{Distance} = \\text{Speed} \\times \\text{Time}$.
   - Relative Speed (same direction) = $S_1 - S_2$; (opposite direction) = $S_1 + S_2$.

4. **Entering Answers**:
   - Navigate to the **Quantitative Aptitude Lab**, input your numeric decimal or integer answer, and click **"✔ Submit Mathematical Answer"**.`;
  } else if (selectedNum === '5') {
    reply = `### 🎯 **Guide: Scoring, Accuracy & Answer Review**

* **Instant Evaluation**: Results are computed automatically immediately upon submitting your assessment.
* **Accuracy Percentage**: Formula: $\\frac{\\text{Correct Answers}}{\\text{Total Questions}} \\times 100\\%$.
* **Detailed Solution Review**:
  - 🟢 **Correct Answers**: Marked with green borders and full rationale.
  - 🔴 **Incorrect/Skipped Answers**: Displays your response side-by-side with the verified solution and step-by-step explanation.
* **Dashboard Sync**: Your overall readiness score and skill progress bars on the Dashboard update in real time!`;
  } else if (selectedNum === '6') {
    reply = `### 📚 **Guide: All Curriculum Subjects & Modules**

EvalSphere PRO includes 5 comprehensive engineering skill tracks:

1. **C Programming**: Pointers, memory allocation (\`malloc\`/\`free\`), arrays, control flow, structs, file I/O.
2. **DBMS & SQL**: Relational algebra, Normalization (1NF-BCNF), ACID properties, complex SQL Joins.
3. **Quantitative Aptitude**: Time-work, percentages, speed-distance, ratios, data interpretation.
4. **Data Structures & Algorithms (DSA)**: Arrays, Linked Lists, Stacks, Queues, Binary Trees, Merge/Quick Sort, Big-O analysis.
5. **Object-Oriented Programming (OOPs)**: Encapsulation, Inheritance, Polymorphism, Abstraction, Design patterns.`;
  } else if (selectedNum === '7') {
    reply = `### ☀️ / 🌙 **Guide: Dark & Light Mode Theme Switcher**

* **Switch Themes**: Click the circular **Sun / Moon** icon in the top-right navigation bar.
* **Dark Mode**: Obsidian & Midnight Sapphire theme with glowing ambient mesh.
* **Light Mode**: Frosted Platinum & Crystal Azure theme with high-contrast text.
* **Auto-Save**: Your theme choice is automatically saved in local storage!`;
  } else if (selectedNum === '8') {
    reply = `### 🔐 **Guide: Persistent Login & OTP Access**

* **Persistent Auto-Login**: Your candidate profile (**Alex Morgan**) is saved automatically on this device. You will not be asked to log in on every refresh.
* **1-Click Direct Access**: If you ever sign out, you can click **"⚡ Instant Enter"** on the gateway to re-enter without OTP.
* **Real OTP Authentication**: Supports real 6-digit verification code dispatch via Email or Mobile SMS.`;
  } else if (q.includes('pointer') || q.includes('dereference') || q.includes('*ptr') || q.includes('address of') || q.includes('&x')) {
    reply = `### 💡 **C Programming: Pointers & Memory Management**

A **pointer** is a variable that stores the direct memory address of another variable:

* **Key Operators**:
  - \`&\` (**Address-of operator**): Retrieves the memory address of a variable.
  - \`*\` (**Dereference operator**): Accesses or modifies the value stored at that address.

* **Code Example**:
\`\`\`c
#include <stdio.h>

int main() {
    int x = 42;
    int *ptr = &x; // ptr holds memory address of x

    printf("Address: %p\\n", (void *)ptr);
    printf("Value: %d\\n", *ptr); // Dereference -> 42

    *ptr = 100; // Modifies x through pointer
    printf("New x: %d\\n", x); // 100
    return 0;
}
\`\`\`

* **Important Pointer Types**:
  - **NULL Pointer**: \`int *p = NULL;\` (Points to nothing, prevents wild pointers).
  - **Dangling Pointer**: Points to deallocated memory after \`free()\`. Always set to \`NULL\` after freeing.
  - **Double Pointer**: \`int **pp = &ptr;\` (Pointer to pointer).`;
  } else if (q.includes('malloc') || q.includes('calloc') || q.includes('realloc') || q.includes('free(') || q.includes('dynamic memory') || q.includes('heap vs stack') || q.includes('memory leak')) {
    reply = `### 💡 **Dynamic Memory Allocation in C (\`stdlib.h\`)**

Dynamic memory is allocated on the **Heap** at runtime:

1. **\`malloc(size)\`**: Allocates raw uninitialized memory bytes.
   \`\`\`c
   int *arr = (int *)malloc(5 * sizeof(int));
   \`\`\`
2. **\`calloc(n, size)\`**: Allocates contiguous memory and initializes all bytes to **zero**.
   \`\`\`c
   int *arr = (int *)calloc(5, sizeof(int));
   \`\`\`
3. **\`realloc(ptr, new_size)\`**: Resizes an existing memory block while preserving data.
4. **\`free(ptr)\`**: Releases allocated memory back to OS to prevent **Memory Leaks**.

* **Complete Safe Template**:
\`\`\`c
int *arr = (int *)malloc(10 * sizeof(int));
if (arr == NULL) {
    fprintf(stderr, "Memory allocation failed!\\n");
    return 1;
}
// Use memory...
free(arr);
arr = NULL; // Prevent dangling pointer
\`\`\``;
  } else if (q.includes('swap') && (q.includes('two number') || q.includes('variable') || q.includes('without third') || q.includes('using pointer'))) {
    reply = `### 💡 **C Program: Swapping Two Numbers**

#### Method 1: Using Pointers (Call by Reference)
\`\`\`c
#include <stdio.h>

void swap(int *a, int *b) {
    int temp = *a;
    *a = *b;
    *b = temp;
}

int main() {
    int x = 10, y = 20;
    swap(&x, &y);
    printf("x = %d, y = %d\\n", x, y); // x = 20, y = 10
    return 0;
}
\`\`\`

#### Method 2: Without Third Variable (Arithmetic / XOR)
\`\`\`c
// Using XOR bitwise:
a = a ^ b;
b = a ^ b;
a = a ^ b;
\`\`\``;
  } else if (q.includes('reverse') || q.includes('palindrome')) {
    reply = `### 💡 **String Reversal & Palindrome Check in C**

A string is a **palindrome** if it reads the same forward and backward (e.g., \`"radar"\`, \`"madam"\`):

\`\`\`c
#include <stdio.h>
#include <string.h>

int isPalindrome(const char *str) {
    int left = 0;
    int right = strlen(str) - 1;
    while (left < right) {
        if (str[left] != str[right]) return 0; // Not a palindrome
        left++;
        right--;
    }
    return 1; // Palindrome
}

int main() {
    char word[] = "level";
    if (isPalindrome(word)) {
        printf("'%s' is a Palindrome!\\n", word);
    }
    return 0;
}
\`\`\`
* Time Complexity: $O(n)$, Space Complexity: $O(1)$.`;
  } else if (q.includes('struct') || q.includes('union') || q.includes('structure')) {
    reply = `### 💡 **C Programming: \`struct\` vs \`union\`**

| Feature | \`struct\` | \`union\` |
| :--- | :--- | :--- |
| **Memory Allocation** | Allocates sum of all member sizes (+ padding). | Allocates size of its **largest** member only. |
| **Member Access** | All members can be accessed simultaneously. | Only **one** member can be stored/accessed at a time. |
| **Memory Sharing** | Each member has unique memory location. | All members share the same memory location. |

\`\`\`c
struct DataS { int i; char c; };  // Size ≈ 8 bytes (due to alignment)
union  DataU { int i; char c; };  // Size = 4 bytes (size of largest: int)
\`\`\``;
  } else if (q.includes('storage class') || q.includes('static') || q.includes('extern') || q.includes('auto') || q.includes('register')) {
    reply = `### 💡 **Storage Classes in C (\`auto\`, \`static\`, \`extern\`, \`register\`)**

1. **\`auto\`**: Default for local variables. Stored on Stack; scope is local block; destroyed when block exits.
2. **\`static\`**: Retains value between function calls. Initialized once in data segment; lifetime spans entire program run.
3. **\`extern\`**: Global variable declared in one file and used in another (\`extern int count;\`).
4. **\`register\`**: Requests CPU register storage for ultra-fast access (\`register int i;\`).`;
  } else if (q.includes('recursion') || q.includes('fibonacci') || q.includes('factorial')) {
    reply = `### 💡 **Recursion in C: Concept & Examples**

**Recursion** is when a function calls itself until reaching a **base condition** to terminate:

#### Factorial ($N! = N \\times (N-1)!$):
\`\`\`c
long long factorial(int n) {
    if (n <= 1) return 1; // Base condition
    return n * factorial(n - 1); // Recursive step
}
\`\`\`

#### Fibonacci Series ($F_n = F_{n-1} + F_{n-2}$):
\`\`\`c
int fibonacci(int n) {
    if (n <= 0) return 0;
    if (n == 1) return 1;
    return fibonacci(n - 1) + fibonacci(n - 2);
}
\`\`\`
* **Tip**: For fast Fibonacci without recursion stack overhead, use dynamic programming or iteration ($O(n)$ time).`;
  } else if (q.includes('normal') || q.includes('1nf') || q.includes('2nf') || q.includes('3nf') || q.includes('bcnf')) {
    reply = `### 💡 **DBMS: Database Normalization (1NF to BCNF)**

Normalization organizes database tables to minimize redundancy and eliminate insertion, update, and deletion anomalies:

1. **1NF (First Normal Form)**:
   - All column values must be **atomic** (single, indivisible values).
   - No repeating groups or arrays.

2. **2NF (Second Normal Form)**:
   - Must be in **1NF**.
   - **No Partial Dependencies**: All non-prime attributes must depend on the whole primary key, not part of a composite key.

3. **3NF (Third Normal Form)**:
   - Must be in **2NF**.
   - **No Transitive Dependencies**: Non-prime attributes must not depend on other non-prime attributes ($X \\to Y \\to Z$).

4. **BCNF (Boyce-Codd Normal Form)**:
   - Stricter form of 3NF.
   - For every functional dependency $X \\to Y$, **$X$ must be a Super Key**!`;
  } else if (q.includes('acid') || q.includes('atomicity') || q.includes('durability') || q.includes('isolation level') || q.includes('transaction')) {
    reply = `### 💡 **DBMS: ACID Properties of Transactions**

ACID guarantees reliable database transactions in enterprise systems:

* **A — Atomicity**: "All-or-Nothing". The transaction either executes completely or rolls back entirely upon error.
* **C — Consistency**: Preserves database integrity constraints (foreign keys, checks, balances) before and after transaction.
* **I — Isolation**: Concurrent transactions execute independently without dirty reads or concurrency anomalies.
* **D — Durability**: Once committed (\`COMMIT\`), changes are written to persistent disk storage and survive crashes.`;
  } else if (q.includes('join') || q.includes('inner join') || q.includes('left join') || q.includes('cross join')) {
    reply = `### 💡 **DBMS: SQL Joins Guide & Examples**

* **INNER JOIN**: Returns rows with matching keys in both tables.
* **LEFT JOIN**: Returns all rows from left table + matched rows from right table (or \`NULL\` if no match).
* **RIGHT JOIN**: Returns all rows from right table + matched rows from left table.
* **FULL OUTER JOIN**: Returns all rows from both tables, filling mismatches with \`NULL\`.
* **CROSS JOIN**: Cartesian product (every row of Table A $\\times$ every row of Table B).

\`\`\`sql
SELECT e.emp_name, e.salary, d.dept_name
FROM employees e
INNER JOIN departments d ON e.dept_id = d.id
WHERE e.salary > 50000
ORDER BY e.salary DESC;
\`\`\``;
  } else if (q.includes('primary key') || q.includes('foreign key') || q.includes('candidate key') || q.includes('super key') || q.includes('composite key') || q.includes('unique key')) {
    reply = `### 💡 **DBMS: Database Keys Explained**

* **Super Key**: Any set of attributes that uniquely identifies a row in a table.
* **Candidate Key**: Minimal Super Key with no redundant attributes.
* **Primary Key**: The chosen candidate key (must be **Unique** and **NOT NULL**).
* **Foreign Key**: A column that references the primary key of another table to establish referential integrity.
* **Composite Key**: A primary key composed of two or more columns combined.
* **Alternate Key**: Candidate keys that were not chosen as the primary key.`;
  } else if (q.includes('drop') && (q.includes('truncate') || q.includes('delete'))) {
    reply = `### 💡 **SQL: \`DELETE\` vs \`TRUNCATE\` vs \`DROP\`**

| Command | Type | Rollback? | WHERE clause? | Performance |
| :--- | :--- | :--- | :--- | :--- |
| **\`DELETE\`** | DML | Yes (Logged row-by-row) | Yes | Slower on large datasets |
| **\`TRUNCATE\`** | DDL | No (Fast deallocation) | No (Removes all rows) | Ultra fast (keeps table structure) |
| **\`DROP\`** | DDL | No | No | Deletes data AND table structure |`;
  } else if (q.includes('index') || q.includes('b-tree') || q.includes('clustered')) {
    reply = `### 💡 **DBMS: Indexes (Clustered vs Non-Clustered)**

An **Index** accelerates \`SELECT\` query lookups by creating a B-Tree search structure:

* **Clustered Index**:
  - Dictates the physical storage order of rows on disk.
  - Only **1** clustered index per table (typically Primary Key).
* **Non-Clustered Index**:
  - Separate structure containing sorted index columns + pointer to physical data row.
  - Multiple non-clustered indexes allowed per table.
* \`CREATE INDEX idx_emp_salary ON employees(salary);\` reduces search time from $O(n)$ full table scan to $O(\\log n)$ index seek!`;
  } else if (q.includes('bst') || q.includes('binary tree') || q.includes('traversal') || q.includes('inorder') || q.includes('preorder') || q.includes('postorder')) {
    reply = `### 💡 **Data Structures: Binary Search Tree (BST) & Traversals**

* **BST Rule**: For any node $N$:
  - Left subtree values $<$ $N$
  - Right subtree values $>$ $N$

* **Tree Traversals**:
  1. **In-Order** (Left $\\to$ Root $\\to$ Right): Always visits nodes in **ascending sorted order**!
  2. **Pre-Order** (Root $\\to$ Left $\\to$ Right): Used to copy or serialize trees.
  3. **Post-Order** (Left $\\to$ Right $\\to$ Root): Used for bottom-up deletion or postfix evaluation.
  4. **Level-Order** (BFS): Visits nodes level by level using a Queue.

* **Complexity**: Search/Insert: $O(\\log n)$ average, $O(n)$ worst (skewed tree).`;
  } else if (q.includes('linked list') || q.includes('floyd') || q.includes('cycle detect') || q.includes('singly') || q.includes('doubly')) {
    reply = `### 💡 **Data Structures: Linked Lists & Floyd's Cycle Detection**

* **Types**: Singly Linked List (\`next\` pointer), Doubly Linked List (\`prev\` and \`next\`), Circular Linked List.
* **Floyd's Cycle-Finding Algorithm (Tortoise and Hare)**:
  - \`slow\` pointer moves 1 step, \`fast\` pointer moves 2 steps.
  - If \`slow == fast\`, a cycle/loop exists in the Linked List ($O(n)$ time, $O(1)$ space).

\`\`\`c
struct Node {
    int data;
    struct Node *next;
};

int hasCycle(struct Node *head) {
    struct Node *slow = head, *fast = head;
    while (fast != NULL && fast->next != NULL) {
        slow = slow->next;
        fast = fast->next->next;
        if (slow == fast) return 1; // Loop detected
    }
    return 0; // No loop
}
\`\`\``;
  } else if ((q.includes('stack') && q.includes('queue')) || q.includes('lifo') || q.includes('fifo')) {
    reply = `### 💡 **Data Structures: Stack vs Queue**

| Property | Stack | Queue |
| :--- | :--- | :--- |
| **Discipline** | **LIFO** (Last In First Out) | **FIFO** (First In First Out) |
| **Insert Operation** | \`push()\` at Top | \`enqueue()\` at Rear |
| **Delete Operation** | \`pop()\` from Top | \`dequeue()\` from Front |
| **Primary Applications**| Function recursion call stack, Undo/Redo, Infix to Postfix, Balanced parentheses. | CPU Task scheduling, Print spooling, Breadth-First Search (BFS). |`;
  } else if (q.includes('sort') || q.includes('bubble sort') || q.includes('merge sort') || q.includes('quick sort') || q.includes('heap sort')) {
    reply = `### 💡 **Data Structures: Sorting Algorithms & Complexities**

| Algorithm | Best Time | Average Time | Worst Time | Space Complexity | Stable? |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Merge Sort** | $O(n \\log n)$ | $O(n \\log n)$ | $O(n \\log n)$ | $O(n)$ | **Yes** |
| **Quick Sort** | $O(n \\log n)$ | $O(n \\log n)$ | $O(n^2)$ | $O(\\log n)$ | **No** |
| **Heap Sort** | $O(n \\log n)$ | $O(n \\log n)$ | $O(n \\log n)$ | $O(1)$ | **No** |
| **Insertion Sort**| $O(n)$ | $O(n^2)$ | $O(n^2)$ | $O(1)$ | **Yes** |
| **Bubble Sort** | $O(n)$ | $O(n^2)$ | $O(n^2)$ | $O(1)$ | **Yes** |

* **Selection Tip**: Use **Merge Sort** when stability and guaranteed $O(n \\log n)$ is needed, and **Quick Sort** for fast in-place cache-friendly sorting!`;
  } else if (q.includes('big o') || q.includes('big-o') || q.includes('time complexity') || q.includes('space complexity') || q.includes('asymptotic')) {
    reply = `### 💡 **Asymptotic Analysis & Big-O Notation**

Big-O measures how an algorithm's execution time or memory scales with input size $n$:

* $O(1)$ — **Constant Time**: Hash map lookup, array indexing by position.
* $O(\\log n)$ — **Logarithmic Time**: Binary search in sorted array.
* $O(n)$ — **Linear Time**: Iterating through an array or linked list.
* $O(n \\log n)$ — **Linearithmic Time**: Merge Sort, Quick Sort (average case).
* $O(n^2)$ — **Quadratic Time**: Nested loops (Bubble Sort, Selection Sort).
* $O(2^n)$ — **Exponential Time**: Naive recursive Fibonacci.`;
  } else if (q.includes('bfs') || q.includes('dfs') || (q.includes('graph') && q.includes('search'))) {
    reply = `### 💡 **Graph Traversals: BFS vs DFS**

* **BFS (Breadth-First Search)**:
  - Explores neighbor nodes layer-by-layer.
  - Data Structure: **Queue**.
  - Best for: Finding shortest path in unweighted graphs.

* **DFS (Depth-First Search)**:
  - Explores as deep as possible along each branch before backtracking.
  - Data Structure: **Stack** or Recursion.
  - Best for: Topological sorting, cycle detection, maze solving.

* Time Complexity: $O(V + E)$ where $V = \\text{Vertices}, E = \\text{Edges}$.`;
  } else if (q.includes('oops') || q.includes('pillar') || q.includes('encapsulation') || q.includes('polymorphism') || q.includes('inheritance') || q.includes('abstraction')) {
    reply = `### 💡 **Object-Oriented Programming (OOP) 4 Core Pillars**

1. **Encapsulation**:
   - Bundling data and methods into a single unit (class) while restricting direct access using \`private\` or \`protected\` access specifiers.
2. **Abstraction**:
   - Hiding complex internal implementation details and exposing only the essential interface to the user.
3. **Inheritance**:
   - Deriving a new class (child/derived) from an existing class (parent/base) to promote code reusability.
4. **Polymorphism**:
   - **Compile-Time**: Function & Operator Overloading.
   - **Run-Time**: Method Overriding using \`virtual\` functions and Dynamic Dispatch (vtable).`;
  } else if (q.includes('overload') && q.includes('overrid')) {
    reply = `### 💡 **Polymorphism: Method Overloading vs Overriding**

| Feature | Method Overloading | Method Overriding |
| :--- | :--- | :--- |
| **Type** | Compile-time (Static) Polymorphism | Run-time (Dynamic) Polymorphism |
| **Scope** | Occurs within the **same** class | Occurs between **Base** and **Derived** classes |
| **Signature** | Same method name, **different parameter list** | Exact **same** method name and signature |
| **Return Type** | Can be different | Must be same (or covariant) |
| **Keywords** | Standard C++/Java definitions | \`virtual\` in C++, \`@Override\` in Java |`;
  } else if (q.includes('time and work') || q.includes('pipes and cistern') || (q.includes('work') && q.includes('day'))) {
    reply = `### 💡 **Quantitative Aptitude: Time & Work Formulas**

1. **Individual Work Rate**:
   - If Person A finishes work in $x$ days, 1 day's work $= \\frac{1}{x}$.
2. **Combined Work**:
   - If A takes $A$ days and B takes $B$ days, together they take:
   $$\\text{Time} = \\frac{A \\times B}{A + B} \\text{ days}$$
3. **Pipes and Cisterns**:
   - Inlet pipe fills in $x$ hours (Rate $= +\\frac{1}{x}$).
   - Outlet pipe empties in $y$ hours (Rate $= -\\frac{1}{y}$).
   - Net rate $= \\frac{1}{x} - \\frac{1}{y}$. Time to fill $= \\frac{xy}{y - x}$ hours.`;
  } else if (q.includes('profit') || q.includes('loss') || q.includes('percentage') || q.includes('discount')) {
    reply = `### 💡 **Quantitative Aptitude: Profit, Loss & Percentage Formulas**

* **Percentage Change**: $\\frac{|\\text{New} - \\text{Old}|}{\\text{Old}} \\times 100\\%$
* **Profit**: $\\text{SP} - \\text{CP}$ $\\longrightarrow$ $\\text{Profit}\\% = \\frac{\\text{SP} - \\text{CP}}{\\text{CP}} \\times 100\\%$
* **Loss**: $\\text{CP} - \\text{SP}$ $\\longrightarrow$ $\\text{Loss}\\% = \\frac{\\text{CP} - \\text{SP}}{\\text{CP}} \\times 100\\%$
* **Discount**: $\\text{Marked Price (MP)} - \\text{Selling Price (SP)}$
* **Successive Percentage Change**: $\\left(a + b + \\frac{ab}{100}\\right)\\%$`;
  } else if (q.includes('speed') || q.includes('distance') || q.includes('train') || q.includes('boat')) {
    reply = `### 💡 **Quantitative Aptitude: Speed, Distance & Time Formulas**

* **Core Formula**: $\\text{Distance} = \\text{Speed} \\times \\text{Time}$ | $\\text{Speed} = \\frac{\\text{Distance}}{\\text{Time}}$
* **Unit Conversion**: $1 \\text{ km/h} = \\frac{5}{18} \\text{ m/s}$ | $1 \\text{ m/s} = \\frac{18}{5} \\text{ km/h}$
* **Average Speed** (for equal distances covered at speeds $x$ and $y$):
  $$\\text{Average Speed} = \\frac{2xy}{x + y}$$
* **Boats & Streams**:
  - Downstream Speed $d = b + s$ (Boat speed $+$ Stream speed)
  - Upstream Speed $u = b - s$
  - Boat in still water: $b = \\frac{d + u}{2}$, Stream speed: $s = \\frac{d - u}{2}$`;
  } else if (q.includes('permutation') || q.includes('combination') || q.includes('probability') || q.includes('p&c')) {
    reply = `### 💡 **Quantitative Aptitude: P&C and Probability**

* **Permutations** (Order matters / Arrangement):
  $$^n P_r = \\frac{n!}{(n - r)!}$$
* **Combinations** (Order does not matter / Selection):
  $$^n C_r = \\frac{n!}{r!(n - r)!}$$
* **Probability**:
  $$P(E) = \\frac{\\text{Number of Favorable Outcomes}}{\\text{Total Number of Elementary Outcomes}}$$
* **Addition Rule**: $P(A \\cup B) = P(A) + P(B) - P(A \\cap B)$
* **Independent Events**: $P(A \\cap B) = P(A) \\times P(B)$`;
  } else if (q.includes('osi') || q.includes('tcp') || q.includes('udp') || q.includes('layer')) {
    reply = `### 💡 **Computer Networks: OSI 7 Layers & TCP vs UDP**

#### The 7 OSI Layers (Bottom to Top):
1. **Physical**: Raw bitstreams across physical media (Cables, Hubs).
2. **Data Link**: MAC addressing, framing, error detection (Switches, Ethernet).
3. **Network**: IP addressing and packet routing (Routers, IP, ICMP).
4. **Transport**: End-to-end communication, reliability, flow control (TCP, UDP).
5. **Session**: Session establishment and authentication.
6. **Presentation**: Data formatting, compression, encryption (TLS, SSL).
7. **Application**: Network applications and end-user protocols (HTTP, DNS, SMTP).

#### TCP vs UDP:
* **TCP**: Connection-oriented, 3-way handshake (SYN, SYN-ACK, ACK), reliable, ordered, error-checked.
* **UDP**: Connectionless, lightweight, low-latency, best for video streaming and live gaming.`;
  } else if (q.includes('process') || q.includes('thread') || q.includes('deadlock') || q.includes('scheduling') || q.includes('paging') || q.includes('virtual memory')) {
    reply = `### 💡 **Operating Systems: Core Concepts & Principles**

* **Process vs Thread**: A **process** is an executing program with its own dedicated memory address space; a **thread** is a lightweight unit of execution within a process that shares memory and resources with other threads.
* **CPU Scheduling**:
  - **FCFS**: First-Come First-Served (non-preemptive).
  - **SJF**: Shortest Job First (optimal average waiting time).
  - **Round Robin**: Preemptive with fixed **Time Quantum**.
* **Deadlock (4 Necessary Conditions)**:
  1. Mutual Exclusion
  2. Hold and Wait
  3. No Preemption
  4. Circular Wait
  *(Avoided using Banker's Algorithm)*
* **Paging & Virtual Memory**: Dividing process virtual address space into fixed-size **Pages** mapped into physical memory **Frames** via the **Page Table**.`;
  } else if (q.includes('how to attend') || q.includes('how to exam') || q.includes('attend exam') || q.includes('take exam') || q.includes('start test') || q.includes('exam rule') || q.includes('instruction')) {
    reply = `### 📝 **Guide: How to Attend Assessments & Exam Rules**

1. Go to **"All Subjects"** or select a module card on your Dashboard.
2. Click **"Launch Objective Assessment"**.
3. Choose your answer with radio buttons (A, B, C, D) and track the countdown timer.
4. Click **"Submit Final Assessment"** for instant scoring and review!`;
  } else if (q.includes('c compiler') || q.includes('c arena') || q.includes('compile c') || q.includes('run c') || q.includes('gcc') || q.includes('c programming') || q.includes('c code')) {
    reply = `### 💻 **Guide: How to Use C Compiler Arena**

1. Open **"C Compiler Arena"** from the top navigation bar.
2. Select your coding challenge and write standard C code.
3. Click **"▶ Run Code"** to test against automated test datasets.
4. Click **"✔ Submit Solution"** once passing!`;
  } else if (q.includes('sql studio') || q.includes('sql') || q.includes('query') || q.includes('dbms') || q.includes('database')) {
    reply = `### ⛁ **Guide: How to Use SQL Studio**

1. Open **"SQL Studio"** from the top navigation bar or DBMS card.
2. Check the active table schema and write standard SQL queries.
3. Click **"▶ Execute SQL Query"** to view live result tables in WebAssembly SQLite.
4. Click **"✔ Submit Solution"** once passing!`;
  } else if (q.includes('hi') || q.includes('hello') || q.includes('hey') || q.includes('morning') || q.includes('evening') || q.includes('namaste') || q === 'help' || q === 'menu') {
    reply = `🐉 **Hello! I'm Drago Assistant. How can I assist your learning & assessment today?**

You can ask me **ANY** technical question or type a number:

* **1** — 📝 How to Attend Assessments & Exam Rules
* **2** — 💻 How to Use C Compiler Arena
* **3** — ⛁ How to Use SQL Studio
* **4** — 📊 Quantitative Aptitude & Math Tips
* **5** — 🎯 Scoring & Answer Review
* **6** — 📚 All Curriculum Subjects Breakdown
* **7** — ☀️/🌙 Dark & Light Mode Switcher
* **8** — 🔐 Persistent Login & Direct Gateway

*(Or ask Drago any question: "What is a pointer in C?", "Explain 3NF", "How to swap numbers", "Merge sort time complexity", etc.)*`;
  } else if (q.includes('thank') || q.includes('thanks') || q.includes('great') || q.includes('awesome') || q.includes('good') || q.includes('nice')) {
    reply = `✨ **You're very welcome!**

I'm always here to help you master algorithms, write clean code, and ace your assessments. Let me know if you need code examples, math formulas, or SQL query help!`;
  } else {
    const topicTitle = query.charAt(0).toUpperCase() + query.slice(1);
    reply = `### 🐉 **Drago Assistant Response: "${topicTitle}"**

Here is a comprehensive technical breakdown for **${topicTitle}**:

1. **Definition & Fundamentals**:
   - In computer science and engineering evaluations, understanding **${topicTitle}** requires analyzing foundational theory, input constraints, and mathematical bounds.
   - Ensure you distinguish between best-case, average-case, and worst-case scenarios.

2. **Key Architectural Principles**:
   - **Data Flow & Logic**: Structure your approach into clear modular functions or subqueries.
   - **Edge Cases**: Always account for boundary values (such as \`0\`, negative inputs, \`NULL\` values, empty sets, or single-element datasets).
   - **Efficiency**: Analyze asymptotic complexity ($O$) to ensure the solution scales with large inputs.

3. **Recommended Next Step**:
   - Test this concept live in **All Subjects** objective assessments or write runnable code in the **C Compiler Arena** / **SQL Studio**!

*Feel free to ask for a code implementation, step-by-step example, or related formulas!*`;
  }

  res.json({
    success: true,
    reply
  });
});

// Fallback route: serve frontend index.html for single-page routing
app.get('*', (req, res) => {
  const indexFile = path.join(frontendDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>EvalSphere API</title></head>
        <body style="font-family:sans-serif;padding:40px;background:#0d1117;color:#c9d1d9;">
          <h1>⚡ EvalSphere Backend Engine</h1>
          <p>Server running on port ${PORT}. Frontend files should be placed in the <code>frontend/</code> directory.</p>
          <p><a href="/api/health" style="color:#58a6ff;">Check /api/health</a></p>
        </body>
      </html>
    `);
  }
});

// Start Server with Graceful Port Error Handling
const server = app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`🚀 EvalSphere Server active at: http://localhost:${PORT}`);
  console.log(`📂 Serving Frontend from:      ${frontendDir}`);
  console.log(`🔑 OTP Verification Engine:    ACTIVE`);
  console.log(`====================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n⚠️  Port ${PORT} is currently occupied by another running instance.`);
    console.error(`👉 Please close the existing server process using Ctrl+C in that terminal, or kill the process.\n`);
  } else {
    console.error('Server error:', err);
  }
});
