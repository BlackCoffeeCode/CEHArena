const fetch = require('node-fetch');

// ⚠️ Netlify Environment Variables से Razorpay Keys लो (ज़रूरी है security के लिए)
const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID || "rzp_test_SLTYGofYzuB9SQ";
const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "YOUR_RAZORPAY_SECRET_HERE";

// Common CORS headers - अपने Firebase domain को allow किया
const headers = {
  'Access-Control-Allow-Origin': 'https://ceharena-b7c23.web.app',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  // 1. Handle Preflight CORS request
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  // 2. Timeout Protection (8 seconds safety margin for 10s Netlify limit)
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const { amount, currency, receipt } = JSON.parse(event.body);

    if (!amount || !currency) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Amount and currency are required' }) };
    }

    // Razorpay API Authentication
    const auth = Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString('base64');

    // 3. Create Order on Razorpay
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      signal: controller.signal, // Timeout signal
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount,
        currency: currency,
        receipt: receipt,
        payment_capture: 1 // Auto capture payment
      })
    });

    clearTimeout(timeout); // Clear timeout if successful
    const data = await response.json();

    if (!response.ok) {
      console.error('Razorpay Error:', data);
      return { 
        statusCode: response.status, 
        headers, 
        body: JSON.stringify({ error: data.error?.description || 'Order creation failed' }) 
      };
    }

    // Return Order ID to frontend
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ orderId: data.id, amount: data.amount, currency: data.currency })
    };

  } catch (error) {
    clearTimeout(timeout);
    console.error('Create Order Catch Error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.name === 'AbortError' ? 'Payment gateway timeout' : error.message })
    };
  }
};
