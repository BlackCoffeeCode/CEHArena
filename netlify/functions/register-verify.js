const crypto = require('crypto');
const admin = require('firebase-admin');

// ✅ Netlify Environment Variables (Uppercase)
const RZP_KEY_SECRET = process.env.RZP_KEY_SECRET;

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  } catch (e) {
    console.error("Firebase Admin Init Error:", e.message);
  }
}
const db = admin.firestore();

// Common CORS headers
const headers = {
  'Access-Control-Allow-Origin': 'https://ceharena-b7c23.web.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { 
      paymentId, 
      orderId, 
      razorpaySignature, 
      planKey, 
      uid, 
      userName, 
      userEmail, 
      userPhone 
    } = JSON.parse(event.body);

    if (!paymentId || !orderId || !razorpaySignature || !uid || !planKey) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // 2. Verify Razorpay Signature
    const body = orderId + "|" + paymentId;
    const expectedSignature = crypto
      .createHmac("sha256", RZP_KEY_SECRET)
      .update(body.toString())
      .digest("hex");

    if (expectedSignature !== razorpaySignature) {
      return { 
        statusCode: 400, 
        headers, 
        body: JSON.stringify({ error: 'Payment verification failed. Signature mismatch.' }) 
      };
    }

    // 3. Save user data to Firestore
    const planDoc = await db.collection('plans').doc(planKey).get();
    const planData = planDoc.exists ? planDoc.data() : {};
    
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + (planData.durationDays || 30));

    await db.collection('users').doc(uid).set({
      name: userName,
      email: userEmail,
      phone: userPhone,
      plan: planKey,
      planName: planData.name || 'Unknown Plan',
      paymentId: paymentId,
      orderId: orderId,
      amount: planData.priceNum || 0,
      status: 'active',
      startDate: admin.firestore.FieldValue.serverTimestamp(),
      expiryDate: admin.firestore.Timestamp.fromDate(expiryDate),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Account activated successfully!' })
    };

  } catch (error) {
    console.error('Verification Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
