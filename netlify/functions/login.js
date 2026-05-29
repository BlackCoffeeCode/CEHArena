const admin = require("firebase-admin");

// Initialize Firebase Admin SDK using FIREBASE_SERVICE_ACCOUNT JSON
if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: "https://ceharena-b7c23-default-rtdb.firebaseio.com"
    });
    console.log("✅ Firebase Admin Initialized");
  } catch (err) {
    console.error("❌ Firebase Admin Init Error:", err.message);
  }
}

const FIREBASE_API_KEY = "AIzaSyAwS3a0DN_JaBjFkzsjEQNFQKKb0kNTkAk";

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method Not Allowed" }) };
  }

  try {
    const { email, password } = JSON.parse(event.body || "{}");

    if (!email || !password) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Email and password required" }) };
    }

    // Step 1: Verify Email/Password via Firebase REST API
    const authResponse = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, returnSecureToken: true }),
      }
    );

    const authData = await authResponse.json();

    if (authData.error) {
      const errorMessages = {
        EMAIL_NOT_FOUND: "User Not Found - Please register first",
        INVALID_PASSWORD: "Wrong Password - Try again",
        USER_DISABLED: "Account disabled",
        TOO_MANY_ATTEMPTS_TRY_LATER: "Too Many Attempts - Try later",
        INVALID_LOGIN_CREDENTIALS: "Invalid Credentials - Check email/password",
      };
      const msg = errorMessages[authData.error.message] || authData.error.message;
      return { statusCode: 401, headers, body: JSON.stringify({ error: msg }) };
    }

    const uid = authData.localId;

    // Step 2: Check Email Verification
    if (!authData.emailVerified) {
      return {
        statusCode: 403,
        headers,
        body: JSON.stringify({
          error: "EMAIL_NOT_VERIFIED",
          idToken: authData.idToken,
          message: "Email not verified."
        }),
      };
    }

    // Step 3: Get Role from Firestore
    let role = "student";
    let name = email.split("@")[0];
    try {
      const userDoc = await admin.firestore().collection("users").doc(uid).get();
      if (userDoc.exists) {
        role = userDoc.data().role || "student";
        name = userDoc.data().name || name;
      }
    } catch (e) {
      console.warn("Firestore read skipped:", e.message);
    }

    // Step 4: Create Custom Token
    const customToken = await admin.auth().createCustomToken(uid);

    // Step 5: Update last_login
    try {
      await admin.firestore().collection("users").doc(uid).update({
        last_login: admin.firestore.FieldValue.serverTimestamp(),
        is_online: true,
        email_verified: true,
      });
    } catch (e) {
      try {
        await admin.firestore().collection("users").doc(uid).set({
          uid, name, email: authData.email, role: "student",
          subscription_status: "free", is_online: true, isActive: true,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          last_login: admin.firestore.FieldValue.serverTimestamp(),
          exams_taken: 0, total_score: 0, email_verified: true,
        });
      } catch (e2) { console.warn("Firestore write skipped:", e2.message); }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ customToken, role, name, email: authData.email, uid }),
    };
  } catch (error) {
    console.error("Login API Error:", error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Server error: " + error.message }) };
  }
};
