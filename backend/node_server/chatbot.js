// backend/node_server/chatbot.js
const OpenAI = require("openai");
const fs = require("fs");
const csv = require("csv-parser");
const path = require("path");

let responses = [];
let isLoaded = false;

// Initialize OpenAI client
let openai = null;
const apiKey = process.env.OPENAI_API_KEY;

if (apiKey && apiKey !== "your-openai-api-key-here") {
  try {
    openai = new OpenAI({
      apiKey: apiKey,
    });
    console.log("OpenAI client initialized successfully");
  } catch (error) {
    console.warn("Failed to initialize OpenAI client:", error.message);
    console.warn("Will use CSV fallback for chatbot responses");
  }
} else {
  console.warn("⚠️ OPENAI_API_KEY not set or invalid. Using CSV dataset fallback.");
  console.warn("To enable OpenAI: Set OPENAI_API_KEY in .env file");
}

// Load nurse dataset for fallback responses
const loadedPromise = new Promise((resolve, reject) => {
  const datasetPath = path.join(__dirname, "../..", "dataset for nurse.csv");
  console.log(`Attempting to load dataset from: ${datasetPath}`);
  
  fs.createReadStream(datasetPath)
    .pipe(csv())
    .on("data", (row) => {
      responses.push(row);
    })
    .on("end", () => {
      isLoaded = true;
      console.log(`✓ Nurse dataset loaded! Total entries: ${responses.length}`);
      resolve(responses.length);
    })
    .on("error", (error) => {
      console.error("❌ Error loading dataset:", error.message);
      console.error("Dataset path attempted:", datasetPath);
      reject(error);
    });
});

// Medical guardrails - topics and keywords to flag
const MEDICAL_GUARDRAILS = {
  diagnosis_keywords: [
    "diagnose",
    "diagnosis",
    "you have",
    "you have a",
    "you suffer from",
  ],
  prescription_keywords: [
    "prescribe",
    "prescription",
    "take this medication",
    "take this drug",
    "this medicine will",
  ],
  emergency_keywords: [
    "emergency",
    "call 911",
    "go to er",
    "go to hospital",
    "severe pain",
    "chest pain",
    "difficulty breathing",
    "loss of consciousness",
  ],
};

// Check if response contains medical advice guardrails
function checkGuardrails(response) {
  const lowerResponse = response.toLowerCase();

  // Only flag if response explicitly says we're diagnosing or prescribing
  // Don't flag if we're just mentioning conditions or symptoms

  // Check for explicit prescription advice (dangerous patterns)
  const dangerousPrescriptionPatterns = [
    /you should take|i recommend.*medication|i prescribe|take this drug|this medicine will cure/i,
  ];
  for (const pattern of dangerousPrescriptionPatterns) {
    if (pattern.test(lowerResponse)) {
      return {
        flagged: true,
        reason: "prescription",
        message:
          "I cannot prescribe medications. Please consult with a healthcare professional.",
      };
    }
  }

  // Check for explicit diagnosis advice (dangerous patterns)
  const dangerousDiagnosisPatterns = [
    /you have.*\b(disease|condition|illness)\b|you are suffering from|you definitely have|you must have/i,
  ];
  for (const pattern of dangerousDiagnosisPatterns) {
    if (pattern.test(lowerResponse)) {
      return {
        flagged: true,
        reason: "diagnosis",
        message:
          "I cannot provide medical diagnosis. Please consult with a doctor.",
      };
    }
  }

  return { flagged: false };
}

// Check if INPUT contains requests for medical advice (preventive guardrail)
function checkInputGuardrails(userInput) {
  const lowerInput = userInput.toLowerCase();

  // Check if user is asking for a prescription
  const prescriptionPatterns = [
    /\b(prescription|prescribe|give me.*medicine|give me.*drug|what medicine)\b/i,
  ];
  for (const pattern of prescriptionPatterns) {
    if (pattern.test(lowerInput)) {
      return {
        flagged: true,
        reason: "prescription_request",
        message:
          "I cannot prescribe medications. I'm not a doctor. Please consult with a healthcare professional for medication recommendations.",
      };
    }
  }

  // Check if user is asking for diagnosis (only block explicit diagnosis requests)
  const diagnosisPatterns = [
    /\b(can you diagnose|diagnose me|what do i have|what disease|what condition|what's wrong with me)\b/i,
    /\b(do i have|am i suffering from)\b.*\b(disease|condition|illness)\b/i,
  ];
  for (const pattern of diagnosisPatterns) {
    if (pattern.test(lowerInput)) {
      return {
        flagged: true,
        reason: "diagnosis_request",
        message:
          "I cannot diagnose medical conditions. Please describe your symptoms and see a healthcare professional for proper diagnosis.",
      };
    }
  }

  // Check for emergency keywords - only TRUE emergencies
  const emergencyPatterns = [
    /\b(severe chest pain|chest pain)\b/i,
    /\b(can't breathe|cannot breathe|difficulty breathing|shortness of breath)\b/i,
    /\b(unconscious|unresponsive|collapsed)\b/i,
    /\b(call 911|emergency|go to.*hospital|go to.*er)\b/i,
  ];
  for (const pattern of emergencyPatterns) {
    if (pattern.test(lowerInput)) {
      return {
        flagged: true,
        reason: "emergency",
        message:
          "⚠️ This sounds like an emergency! Please call 911 or go to the nearest emergency room immediately.",
      };
    }
  }

  return { flagged: false };
}

// Get response from OpenAI with medical guardrails
async function getResponse(userInput) {
  if (!userInput || typeof userInput !== "string") {
    return "I didn't understand that. Could you please describe your symptoms or health concern?";
  }

  // FIRST: Check input for guardrail violations (preventive)
  const inputGuardrailCheck = checkInputGuardrails(userInput);
  if (inputGuardrailCheck.flagged) {
    console.log(`Guardrail triggered (${inputGuardrailCheck.reason}):`, userInput);
    return inputGuardrailCheck.message;
  }

  // If OpenAI is not available, return an explanatory error (no CSV fallback)
  if (!openai) {
    console.warn('OpenAI client not initialized; OpenAI-only mode is enabled, no CSV fallback.');
    return "OpenAI is not configured. Please set a valid OPENAI_API_KEY in the server's .env file.";
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a caring and supportive nursing assistant designed to provide general wellness information and health reminders.

      IMPORTANT GUARDRAILS:
      - You are NOT a doctor and cannot diagnose medical conditions
      - You must NOT prescribe medications or recommend specific drugs
      - You must NOT provide treatment plans
      - If symptoms suggest a medical emergency (severe pain, difficulty breathing, chest pain, loss of consciousness), advise the user to call 911 immediately
      - For any serious health concerns, always recommend consulting a qualified healthcare professional
      - Focus on: wellness tips, healthy habits, appointment reminders, medication reminders, general symptom information
      - Always be empathetic and supportive

      Remember: If the user describes symptoms that could indicate a serious condition, recommend they see a doctor rather than trying to help them self-diagnose.`,
        },
        {
          role: "user",
          content: userInput,
        },
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    let botReply =
      response.choices[0]?.message?.content ||
      "I'm here to help with your health questions.";

    // Check the response against guardrails
    const guardrailCheck = checkGuardrails(botReply);
    if (guardrailCheck.flagged) {
      return guardrailCheck.message;
    }

    return botReply;
  } catch (error) {
    console.error("OpenAI error:", error && error.message ? error.message : error);
    console.warn("OpenAI request failed and CSV fallback is disabled in OpenAI-only mode.");
    return "I'm sorry — I'm unable to access the AI service right now. Please try again later.";
  }
}

// Fallback function for CSV dataset responses
function getFallbackResponse(userInput) {
  if (!isLoaded || responses.length === 0) {
    return "I'm loading my knowledge base. Please try again in a moment.";
  }

  const lowerInput = userInput.toLowerCase().trim();

  // Search through responses using "User Query" column
  for (const r of responses) {
    if (
      r["User Query"] &&
      r["User Query"].toLowerCase().includes(lowerInput)
    ) {
      return r["Bot Response"] || "I found information related to that.";
    }
  }

  return "I'm here to help with your health questions. Please describe your symptoms or health concern.";
}

module.exports = { getResponse, loadedPromise };
