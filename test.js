const fs = require('fs');

async function test() {
  const apiKey = "AQ.Ab8RN6LEj84KeBBQfqTz67bAqKSTn4UklY60AubW5IYHZFkFvQAQ.Ab8RN6LEj84KeBBQfqTz67bAqKSTn4UklY60AubW5IYHZFkFvQ";
  
  // 1 pixel transparent png base64
  const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const mimeType = "image/png";

  const prompt = `Extract bookkeeping details from the provided invoice/receipt image.
Additional context from user: None

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

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
        console.log("ERROR STATUS:", response.status);
        console.log("ERROR TEXT:", await response.text());
        return;
    }
    
    const result = await response.json();
    console.log("SUCCESS TEXT:", result.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (e) {
    console.log("CATCH:", e);
  }
}
test();
