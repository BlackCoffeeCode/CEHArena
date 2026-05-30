const Razorpay = require('razorpay');
const admin = require('firebase-admin');
const { Resend } = require('resend'); // Email Service

if (!admin.apps.length) {
  var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();
const resend = new Resend(process.env.RESEND_API_KEY); // Add this in Netlify Env

const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET
});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  try {
    const { paymentId, planKey, uid, userName, userEmail } = JSON.parse(event.body);

    if (!paymentId || !planKey || !uid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Step 1: Fetch & Capture Payment
    var payment = await razorpay.payments.fetch(paymentId);
    if (payment.status === 'authorized') {
      try { payment = await razorpay.payments.capture(paymentId, payment.amount); } 
      catch (captureErr) { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Capture failed' }) }; }
    }
    if (payment.status !== 'captured') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not captured' }) };
    }

    // Step 2: Verify Plan & Amount
    const normalizedKey = planKey.toLowerCase().trim();
    const planDoc = await db.collection('plans').doc(normalizedKey).get();
    if (!planDoc.exists) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan' }) };

    const planData = planDoc.data();
    if (!planData.active) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan inactive' }) };

    const planPriceInPaise = planData.priceNum * 100;
    if (payment.amount !== planPriceInPaise) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount mismatch' }) };
    }

    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + planData.durationDays * 24 * 60 * 60 * 1000)
    );

    // Step 3: Create User Account in Firestore (NOW ACCOUNT IS OFFICIALLY CREATED)
    await db.collection('users').doc(uid).set({
      uid: uid,
      name: userName || 'User',
      email: userEmail || payment.email || '',
      phone: payment.contact || '',
      role: 'student',
      subscription_status: 'active',
      plan: normalizedKey,
      features: planData.features || [],
      planActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
      planExpiresAt: expiresAt,
      isActive: true,
      is_online: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      last_login: admin.firestore.FieldValue.serverTimestamp(),
      exams_taken: 0,
      total_score: 0
    });

    // Step 4: Save Payment Details for Admin
    await db.collection('payments').add({
      user_id: uid,
      user_name: userName,
      user_email: userEmail,
      plan_key: normalizedKey,
      plan_name: planData.name,
      amount: payment.amount / 100,
      currency: payment.currency,
      razorpay_payment_id: paymentId,
      razorpay_order_id: payment.order_id || '',
      method: payment.method || 'online', // card, upi, netbanking
      bank: payment.bank || '',
      wallet: payment.wallet || '',
      vpa: payment.vpa || '', // UPI ID
      status: 'verified',
      captured_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Step 5: Send Welcome Email 📧
    try {
      await resend.emails.send({
        from: 'CEH Arena <no-reply@ceharena.com>', // Apna verified domain daalo
        to: userEmail,
        subject: `Welcome to CEH Arena! Your ${planData.name} Plan is Active 🎉`,
        html: `
          <div style="font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #0a0e1a; border-radius: 16px; overflow: hidden; border: 1px solid #1e1e2e;">
            <div style="background: linear-gradient(135deg, #6366f1, #8b5cf6); padding: 32px; text-align: center;">
              <h1 style="color: white; font-size: 28px; margin: 0;">🛡️ CEH Arena</h1>
              <p style="color: rgba(255,255,255,0.8); margin-top: 8px; font-size: 14px;">Account Successfully Created</p>
            </div>
            <div style="padding: 32px; color: #e4e4e7;">
              <h2 style="color: #fff; margin-bottom: 12px;">Welcome, ${userName}! 👋</h2>
              <p style="color: #a1a1aa; font-size: 15px; line-height: 1.6;">Your account has been successfully created and your payment has been verified.</p>
              
              <div style="background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.2); border-radius: 12px; padding: 20px; margin: 24px 0;">
                <h3 style="color: #818cf8; margin: 0 0 12px; font-size: 16px;">✅ ${planData.name} Plan Activated</h3>
                <p style="color: #a1a1aa; margin: 4px 0; font-size: 14px;"><strong style="color: #e4e4e7;">Amount Paid:</strong> ₹${payment.amount / 100}</p>
                <p style="color: #a1a1aa; margin: 4px 0; font-size: 14px;"><strong style="color: #e4e4e7;">Valid For:</strong> ${planData.durationDays} Days</p>
              </div>

              <div style="text-align: center; margin: 32px 0;">
                <a href="https://yourdomain.com/login.html" style="background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 14px 32px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; display: inline-block; box-shadow: 0 4px 15px rgba(99,102,241,0.3);">
                  🔐 Login to Your Dashboard
                </a>
              </div>

              <p style="color: #71717a; font-size: 12px; text-align: center; margin-top: 24px; border-top: 1px solid #1e1e2e; padding-top: 16px;">
                Payment ID: ${paymentId}<br>
                If you did not initiate this, please contact support immediately.
              </p>
            </div>
          </div>
        `
      });
      console.log('✅ Welcome email sent to:', userEmail);
    } catch (emailErr) {
      console.warn('⚠️ Email failed:', emailErr.message); // Account still created even if email fails
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Account created & plan activated!' })
    };

  } catch (error) {
    console.error('Verification Error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ success: false, error: error.message }) };
  }
};
