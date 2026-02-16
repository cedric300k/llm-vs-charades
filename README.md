# LLM vs You: Charades (Gemini)

A 1-minute web charades game where you compete against a Gemini-powered LLM:

1. **Your turn:** you act on webcam and Gemini tries to guess.
2. **Gemini turn:** Gemini generates a photo-style scene and you guess what it represents.
3. Highest score after 60 seconds wins.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Create a `.env` file:
   ```bash
   GEMINI_API_KEY=your_api_key_here
   PORT=3000
   ```
3. Run the app:
   ```bash
   npm start
   ```
4. Open `http://localhost:3000`.

## Notes

- You must allow camera access in your browser.
- Gemini image generation endpoint/model availability can vary by account/region. If image generation fails, verify model access for your API key.
