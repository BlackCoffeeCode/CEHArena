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
    const { paymentId, planKey, uid } = JSON.parse(event.body);

    if (!paymentId || !planKey || !uid) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

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

    // ✅ FIX: Convert planKey to lowercase to handle any mismatch
    const normalizedKey = planKey ? planKey.toLowerCase().trim() : '';
    
    const planConfig = {
       starter:  { price: 34900, days: 30 },
       advanced: { price: 49900, days: 30 },
       ultimate: { price: 69900, days: 30 }
    };

    const plan = planConfig[normalizedKey];
    if (!plan) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan key: ' + normalizedKey }) };
    }

    if (payment.amount > plan.price || payment.amount < 10000) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount mismatch! Fraud detected.' }) };
    }

    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + plan.days * 24 * 60 * 60 * 1000)
    );

    await db.collection('users').doc(uid).update({
      plan: normalizedKey, // Save the corrected lowercase key
      planExpiresAt: expiresAt,
      subscription_status: 'active',
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    await db.collection('payments').add({
      user_id: uid,
      plan_key: normalizedKey,
      amount: payment.amount / 100,
      razorpay_payment_id: paymentId,
      status: 'verified',
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

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
