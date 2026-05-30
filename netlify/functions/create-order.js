const Razorpay = require('razorpay');

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

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  try {
    const { amount, uid, planId, planName } = JSON.parse(event.body);

    // Validation
    if (!amount || !uid || !planId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields (amount, uid, planId)' }) };
    }

    // Create Razorpay Order
    const order = await razorpay.orders.create({
      amount: amount, // Amount in paise (e.g., 34900 for ₹349)
      currency: 'INR',
      receipt: `receipt_${uid}_${Date.now()}`,
      notes: { 
        uid: uid, 
        planId: planId,
        planName: planName || 'N/A'
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(order)
    };

  } catch (error) {
    console.error('Order Creation Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
