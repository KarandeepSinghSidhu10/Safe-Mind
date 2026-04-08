import 'dotenv/config';
import express from 'express';
import path from 'path';
import twilio from 'twilio';
import { OAuth2Client } from 'google-auth-library';
import Groq from 'groq-sdk';

const app = express();
const PORT = 3000;

app.use(express.json());

let groqClient: Groq | null = null;

function getGroq(): Groq {
    if (!groqClient) {
        const key = process.env.GROQ_API_KEY;
        if (!key) {
            throw new Error('GROQ_API_KEY environment variable is required');
        }
        groqClient = new Groq({ apiKey: key });
    }
    return groqClient;
}

app.get('/api/test-key', (req, res) => {
    res.json({ 
        groq: process.env.GROQ_API_KEY ? process.env.GROQ_API_KEY.substring(0, 4) : null,
        allKeys: Object.keys(process.env).filter(k => k.includes('GROQ'))
    });
});

app.post('/api/analyze-incident', async (req, res) => {
    try {
        const { description } = req.body;
        const response = await getGroq().chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "You are an incident analysis assistant. Return ONLY a JSON object with the following structure: {\"predictedSeverity\": \"Low\" | \"Medium\" | \"High\" | \"Critical\", \"potentialRisks\": [\"risk1\", \"risk2\"]}"
                },
                {
                    role: "user",
                    content: `Analyze the following incident description reported by a user.\nDetermine a predicted severity level (Low, Medium, High, Critical) and list 2-3 potential risks or safety concerns associated with this incident.\n\nDescription: "${description}"`
                }
            ],
            response_format: { type: "json_object" }
        });
        res.json(JSON.parse(response.choices[0].message.content || "{}"));
    } catch (error) {
        console.error("Groq API Error (Incident Analysis):", error);
        res.status(500).json({ error: 'Failed to analyze incident' });
    }
});

app.post('/api/analyze-emotion', async (req, res) => {
    try {
        const { text } = req.body;
        const response = await getGroq().chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                {
                    role: "system",
                    content: "You are an emotion analysis assistant. Return ONLY a JSON object with the following structure: {\"primaryEmotion\": \"string\", \"secondaryEmotions\": [\"string\"], \"stressLevel\": number (0-100), \"anxietyLevel\": number (0-100), \"energyLevel\": number (0-100), \"focusLevel\": number (0-100), \"supportiveMessage\": \"string\", \"copingMechanisms\": [\"string\"]}"
                },
                {
                    role: "user",
                    content: `Analyze the emotional state of the following text transcribed from a user's voice.\nDetermine their primary emotion (e.g., Calm, Anxious, Stressed, Happy, Sad, Angry, Fearful) and secondary emotions.\nProvide granular scores (0-100%) for: stress level, anxiety level, energy level, and focus level.\nAlso provide a short, supportive 1-sentence response, and 2-3 actionable coping mechanisms tailored to their emotional state.\n\nText: "${text}"`
                }
            ],
            response_format: { type: "json_object" }
        });
        res.json(JSON.parse(response.choices[0].message.content || "{}"));
    } catch (error) {
        console.error("Groq API Error (Emotion Analysis):", error);
        res.status(500).json({ error: 'Failed to analyze emotion' });
    }
});

app.post('/api/chat', async (req, res) => {
    try {
        const { message, history } = req.body;
        
        const messages: any[] = [
            { role: "system", content: "You are SafeMind AI, a supportive, empathetic wellness and safety companion. Keep responses concise, helpful, and caring." }
        ];
        
        history.forEach((msg: any) => {
            messages.push({
                role: msg.role === 'ai' ? 'assistant' : 'user',
                content: msg.text
            });
        });
        
        messages.push({ role: 'user', content: message });

        const response = await getGroq().chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: messages
        });
        
        res.json({ text: response.choices[0].message.content });
    } catch (error: any) {
        console.error("Groq API Error (Chat):", error);
        res.status(500).json({ error: 'Failed to generate chat response', details: error.message });
    }
});

// --- Authentication ---
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

app.get('/api/auth/url', (req, res) => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        // If keys are missing, return a local URL that triggers the mock login flow
        return res.json({ url: '/auth/callback?code=mock_code' });
    }

    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        access_type: 'offline',
        prompt: 'consent'
    });
    
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    res.json({ url: authUrl });
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    const redirectUri = `${req.protocol}://${req.get('host')}/auth/callback`;
    
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
        console.log('Google OAuth not configured. Mocking login.');
        return res.send(`
            <html>
                <body>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                            window.close();
                        } else {
                            window.location.href = '/';
                        }
                    </script>
                    <p>Authentication successful (Mocked). This window should close automatically.</p>
                </body>
            </html>
        `);
    }

    try {
        const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri);
        const { tokens } = await client.getToken(code as string);
        client.setCredentials(tokens);
        
        const ticket = await client.verifyIdToken({
            idToken: tokens.id_token!,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();

        res.send(`
            <html>
                <body>
                    <script>
                        if (window.opener) {
                            window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
                            window.close();
                        } else {
                            window.location.href = '/';
                        }
                    </script>
                    <p>Authentication successful. This window should close automatically.</p>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.status(500).send('Authentication failed');
    }
});
// ----------------------

app.post('/api/sos', async (req, res) => {
    const { lat, lng, profile } = req.body;
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
    const toNumbers = profile?.contacts?.map((c: any) => c.phone).filter(Boolean) || [];

    if (!accountSid || !authToken || !twilioNumber) {
        // Mock success if Twilio is not configured
        console.log('Twilio not configured. Mocking SOS message.');
        console.log(`SOS Location: ${lat}, ${lng}`);
        console.log(`Sending to: ${toNumbers.join(', ')}`);
        return res.json({ success: true, mocked: true });
    }

    try {
        const client = twilio(accountSid, authToken);
        let locationText = 'Location unavailable.';
        if (lat && lng) {
            locationText = `https://maps.google.com/?q=${lat},${lng}`;
        }
        
        const messageBody = `SOS ALERT from ${profile?.name || 'a user'}! I need help. My current location is: ${locationText}`;
        
        const promises = toNumbers.map((number: string) => {
            return client.messages.create({
                body: messageBody,
                from: twilioNumber,
                to: number
            });
        });
        
        await Promise.all(promises);
        res.json({ success: true });
    } catch (error) {
        console.error('Twilio Error:', error);
        res.status(500).json({ error: 'Failed to send SOS messages' });
    }
});

async function startServer() {
    app.use(express.static(process.cwd()));
    app.get('*', (req, res) => {
        res.sendFile(path.join(process.cwd(), 'index.html'));
    });

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();
