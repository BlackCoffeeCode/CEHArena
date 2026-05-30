const Razorpay = require('razorpay');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  var serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}
const db = admin.firestore();

const razorpay = new Razorpay({
  key_id: process.env.RZP_KEY_ID,
  key_secret: process.env.RZP_KEY_SECRET
});

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { paymentId, planKey, uid, userName, userEmail } = JSON.parse(event.body);

    if (!paymentId || !planKey || !uid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Step 1: Fetch & Capture Payment
    var payment = await razorpay.payments.fetch(paymentId);

    if (payment.status === 'authorized') {
      try {
        payment = await razorpay.payments.capture(paymentId, payment.amount);
      } catch (captureErr) {
        console.error('Capture Error:', captureErr);
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Failed to capture payment' }) };
      }
    }

    if (payment.status !== 'captured') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Payment not captured' }) };
    }

    // Step 2: Verify Plan & Amount
    const normalizedKey = planKey ? planKey.toLowerCase().trim() : '';
    const planDoc = await db.collection('plans').doc(normalizedKey).get();
    
    if (!planDoc.exists) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan key: ' + normalizedKey + '. Plan not found in database.' }) };
    }

    const planData = planDoc.data();
    
    if (!planData.active) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Plan is currently inactive.' }) };
    }

    const planPriceInPaise = planData.priceNum * 100;
    if (payment.amount > planPriceInPaise || payment.amount < 10000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount mismatch! Fraud detected.' }) };
    }

    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + planData.durationDays * 24 * 60 * 60 * 1000)
    );

    // Step 3: Create User Account in Firestore (Features Unlocked)
    await db.collection('users').doc(uid).update({
      name: userName || 'User',
      email: userEmail || '',
      phone: payment.contact || '',
      plan: normalizedKey,
      planExpiresAt: expiresAt,
      subscription_status: 'active',
      features: planData.features || [],
      updated_at: admin.firestore.FieldValue.serverTimestamp()
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
      method: payment.method || 'online',
      bank: payment.bank || '',
      wallet: payment.wallet || '',
      vpa: payment.vpa || '',
      status: 'verified',
      source: 'registration',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Account activated for:', userEmail, '| Plan:', planData.name);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Plan activated successfully!' })
    };

  } catch (error) {
    console.error('Verification Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
