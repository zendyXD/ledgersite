export async function extractFromImage(imageBase64: string, mimeType: string, commentContext?: string | null): Promise<{
  extracted_party: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_text: string | null;
  guessed_category: string | null;
  guessed_type: "income" | "expense" | null;
  extraction_confidence: Record<string, string>;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in the environment variables.");
  }

  // Ensure base64 string doesn't contain the data URL prefix
  const base64Data = imageBase64.replace(/^data:.*?;base64,/, "");

  const prompt = `Extract bookkeeping details from the provided invoice/receipt image.
Additional context from user: ${commentContext || "None"}

IMPORTANT: You must extract details for ANY type of payment screenshot or receipt. 
Tip for PhonePe: specifically look for 'Banking Name', 'Debited from', and 'Transfer Details' fields to identify the party.

Return a JSON object with EXACTLY the following fields:
- extracted_party (string or null): the person or business paid or received from.
- extracted_amount (number or null): the total amount of the transaction.
- extracted_date (string or null): the date of the transaction in YYYY-MM-DD format.
- extracted_text (string or null): all relevant text found in the image.
- guessed_category (string or null): a suggested category for this transaction (e.g., Food, Travel, Utilities, Software).
- guessed_type ("income", "expense", or null): whether this represents an income or an expense.
- extraction_confidence (object): key-value pairs of string to string indicating your confidence for each extracted field (e.g., "amount": "high").`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType: mimeType || "image/jpeg",
              data: base64Data
            }
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textResponse) {
    console.error("Gemini Response Error:", JSON.stringify(result, null, 2));
    throw new Error("Gemini returned an empty or invalid response.");
  }

  // Gemini sometimes wraps JSON in markdown blocks even with responseMimeType
  textResponse = textResponse.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(textResponse);
    return {
      extracted_party: parsed.extracted_party ?? null,
      extracted_amount: parsed.extracted_amount ?? null,
      extracted_date: parsed.extracted_date ?? null,
      extracted_text: parsed.extracted_text ?? null,
      guessed_category: parsed.guessed_category ?? null,
      guessed_type: (parsed.guessed_type === "income" || parsed.guessed_type === "expense") ? parsed.guessed_type : "expense",
      extraction_confidence: parsed.extraction_confidence ?? {}
    };
  } catch (err) {
    console.error("Failed to parse Gemini JSON output. Raw text:", textResponse);
    throw new Error("Failed to parse Gemini JSON output: " + (err instanceof Error ? err.message : String(err)));
  }
}

export async function reviseExtractedDetails(
  currentFields: any,
  correctionText: string
): Promise<{
  extracted_party: string | null;
  extracted_amount: number | null;
  extracted_date: string | null;
  extracted_text: string | null;
  guessed_category: string | null;
  guessed_type: "income" | "expense" | null;
  extraction_confidence: Record<string, string>;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set in the environment variables.");
  }

  const prompt = `You are an AI assisting in refining extracted bookkeeping details from a payment screenshot or receipt.
The user has provided a free-text correction for the currently extracted fields.

Current Extracted Fields:
${JSON.stringify(currentFields, null, 2)}

User's Correction Text:
"${correctionText}"

Apply the user's correction to the current fields. Keep the exact same JSON format.
Return a JSON object with EXACTLY the following fields:
- extracted_party (string or null): the person or business paid or received from.
- extracted_amount (number or null): the total amount of the transaction.
- extracted_date (string or null): the date of the transaction in YYYY-MM-DD format.
- extracted_text (string or null): all relevant text found in the image. Keep the previous value if no text updates are needed.
- guessed_category (string or null): a suggested category for this transaction (e.g., Food, Travel, Utilities, Software).
- guessed_type ("income", "expense", or null): whether this represents an income or an expense.
- extraction_confidence (object): key-value pairs of string to string indicating your confidence for each extracted field (e.g., "amount": "high").`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json"
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error during edit: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  let textResponse = result.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!textResponse) {
    console.error("Gemini Response Error during edit:", JSON.stringify(result, null, 2));
    throw new Error("Gemini returned an empty or invalid response during edit.");
  }

  textResponse = textResponse.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();

  try {
    const parsed = JSON.parse(textResponse);
    return {
      extracted_party: parsed.extracted_party ?? null,
      extracted_amount: parsed.extracted_amount ?? null,
      extracted_date: parsed.extracted_date ?? null,
      extracted_text: parsed.extracted_text ?? null,
      guessed_category: parsed.guessed_category ?? null,
      guessed_type: (parsed.guessed_type === "income" || parsed.guessed_type === "expense") ? parsed.guessed_type : "expense",
      extraction_confidence: parsed.extraction_confidence ?? {}
    };
  } catch (err) {
    console.error("Failed to parse Gemini JSON output during edit. Raw text:", textResponse);
    throw new Error("Failed to parse Gemini JSON output during edit: " + (err instanceof Error ? err.message : String(err)));
  }
}
