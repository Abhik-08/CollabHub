const express = require("express");
const router = express.Router();
require("dotenv").config();

// --- 1. CONFIGURATION & STATE ---
let googleAiClient; // Holds the initialized client
let ioRef; // Holds the Socket.IO instance

/**
 * Initializes the Gemini Client lazily.
 * This ensures the server starts even if the API key is temporarily missing.
 */
async function getGeminiClient() {
  if (googleAiClient) return googleAiClient;
  
  // Dynamic import for the new SDK
  const { GoogleGenAI } = await import("@google/genai");
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.COLLABHUB_GEMINI_API_KEY;
  
  // Fail fast if key is missing when we actually try to use it
  if (!apiKey) {
    throw new Error("MISSING_API_KEY");
  }

  googleAiClient = new GoogleGenAI({ apiKey: apiKey });
  return googleAiClient;
}

/**
 * Setter to pass the Socket.IO instance from server.js
 */
function setSocket(io) {
  ioRef = io;
}

// --- 2. MAIN ROUTE HANDLER ---
router.post("/", async (req, res) => {
  const { message, room } = req.body;

  try {
    // A. Initialize Client
    const ai = await getGeminiClient();

    // B. Call Gemini API
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash", 
      config: { 
        systemInstruction: "You are CollabAI, a helpful coding assistant.",
        temperature: 0.7,
      },
      contents: [
        {
          role: "user",
          parts: [{ text: message }]
        }
      ],
    });

    // C. Extract Response
    const aiReply = response.text || "I'm not sure about that.";

    // D. Success: Emit to Room
    if (ioRef && room) {
      ioRef.to(room).emit("newMessage", {
        user: "CollabAI 🤖",
        message: aiReply,
      });
    }

    // E. Success: Response to HTTP Client
    res.json({ reply: aiReply }); 

  } catch (error) {
    // --- 3. ROBUST ERROR HANDLING ---

    // Default generic error (Safe for user)
    let userFriendlyError = "❌ Service Unavailable: The AI is having trouble connecting.";
    let statusCode = 500;

    // Convert error to string for inspection
    const errorDetails = JSON.stringify(error) || error.message || "";

    // -- Scenario A: Rate Limits (429) --
    if (error.status === 429 || error.code === 429) {
      statusCode = 429;
      if (errorDetails.includes("GenerateRequestsPerDay")) {
        userFriendlyError = "⚠️ Daily Limit Reached: The AI has hit its maximum usage for today. Resets at midnight (PT).";
      } else {
        userFriendlyError = "⏳ High Traffic: Please wait 30-60 seconds before sending another message.";
      }
    } 
    
    // -- Scenario B: Missing API Key (Custom Error from step A) --
    else if (error.message === "MISSING_API_KEY") {
        console.error("🚨 CONFIG ERROR: GEMINI_API_KEY / COLLABHUB_GEMINI_API_KEY is missing in .env");
        userFriendlyError = "⚙️ System Error: AI service is not configured correctly.";
    }

    // -- Scenario C: Auth / Permission Issues --
    else if (error.status === 401 || error.status === 403) {
      console.error("🚨 AUTH ERROR: Invalid API Key or Permissions.");
      userFriendlyError = "⚙️ System Error: Invalid AI credentials.";
    }
    
    // -- Scenario D: Safety/Blocked Content --
    else if (error.status === 400 && errorDetails.includes("SAFETY")) {
        statusCode = 400;
        userFriendlyError = "🛡️ Safety Alert: The AI could not respond to that specific prompt.";
    }

    // Log the actual raw error for developer debugging
    if (statusCode === 500) {
        console.error("🔥 INTERNAL SERVER ERROR:", error);
    } else {
        console.log(`ℹ️ Handled AI Error (${statusCode}):`, userFriendlyError);
    }

    // Emit the System Alert to the chat room
    if (ioRef && room) {
      ioRef.to(room).emit("newMessage", {
        user: "System ⚠️", 
        message: userFriendlyError,
      });
    }

    // Return the error state to the client
    res.status(statusCode).json({ reply: userFriendlyError });
  }
});

module.exports = { router, setSocket };