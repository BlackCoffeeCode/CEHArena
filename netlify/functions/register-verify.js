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

    // Step 1: Fetch Payment from Razorpay
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

    // Step 2: Fetch Plan Details from Firestore
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

    // Step 3: Calculate Expiry & Get Features
    const expiresAt = admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + planData.durationDays * 24 * 60 * 60 * 1000)
    );
    
    // 🔥 IMPORTANT: Fetch features from the plan to unlock dashboard access
    const planFeatures = planData.features || [];

    // Step 4: Update User Document in Firestore
    await db.collection('users').doc(uid).update({
      plan: normalizedKey,
      planExpiresAt: expiresAt,
      subscription_status: 'active',
      features: planFeatures, // Yeh line dashboard ko batayegi ki kya content dikhana hai
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });

    // Step 5: Save Payment Record
    await db.collection('payments').add({
      user_id: uid,
      plan_key: normalizedKey,
      amount: payment.amount / 100,
      razorpay_payment_id: paymentId,
      status: 'verified',
      source: 'registration', // Isse pata chalega ki yeh payment registration se aayi thi
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Plan activated successfully!' })
    };

  } catch (error) {
    console.error('Registration Verify Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ success: false, error: error.message })
    };
  }
};
