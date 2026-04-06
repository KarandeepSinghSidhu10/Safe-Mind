import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import twilio from 'twilio';
import { OAuth2Client } from 'google-auth-library';

const app = express();
const PORT = 3000;

app.use(express.json());

// In-memory database
let profile = {
    name: 'Jane Doe',
    email: 'jane.doe@example.com',
    contacts: [
        { name: 'Mom', phone: '555-0101' },
        { name: 'Roommate', phone: '555-0102' }
    ]
};

let journals = [
    { id: 1, date: '4/1/2026 10:00 AM', text: 'Felt really anxious walking home today, but the app helped me stay calm.', mood: '😰' },
    { id: 2, date: '3/30/2026 08:30 PM', text: 'Had a great day! The new route was well-lit and felt very safe.', mood: '😁' }
];

let incidents = [
    { id: 1, title: 'Street harassment reported', desc: 'A group of individuals making inappropriate comments near the bus stop.', time: '8 min ago', distance: '0.2 miles', severity: 'high', icon: 'alert-triangle', latOffset: 0.005, lngOffset: -0.005, confirmations: 3 },
    { id: 2, title: 'Broken streetlights', desc: 'Multiple streetlights are out on this block, making it very dark and unsafe to walk.', time: '25 min ago', distance: '0.5 miles', severity: 'med', icon: 'lightbulb-off', latOffset: -0.008, lngOffset: 0.002, confirmations: 0 },
    { id: 3, title: 'Suspicious activity', desc: 'Someone loitering near the alleyway for an extended period, observing passersby.', time: '1h ago', distance: '1.1 miles', severity: 'med', icon: 'eye', latOffset: 0.002, lngOffset: 0.008, confirmations: 1 }
];

// API Routes

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
        profile.name = 'Mocked Google User';
        profile.email = 'mocked@gmail.com';
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
        
        if (payload) {
            profile.name = payload.name || profile.name;
            profile.email = payload.email || profile.email;
        }

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

app.get('/api/profile', (req, res) => {
    res.json(profile);
});

app.post('/api/profile', (req, res) => {
    profile = { ...profile, ...req.body };
    res.json({ success: true, profile });
});

app.get('/api/journals', (req, res) => {
    res.json(journals);
});

app.post('/api/journals', (req, res) => {
    const { text, mood, date } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });
    
    const newEntry = { id: Date.now(), date, text, mood };
    journals.unshift(newEntry);
    res.json({ success: true, entry: newEntry });
});

app.delete('/api/journals/:id', (req, res) => {
    const id = parseInt(req.params.id);
    journals = journals.filter(j => j.id !== id);
    res.json({ success: true });
});

app.get('/api/incidents', (req, res) => {
    res.json(incidents);
});

app.post('/api/sos', async (req, res) => {
    const { lat, lng } = req.body;
    
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioNumber = process.env.TWILIO_PHONE_NUMBER;
    const toNumbers = profile.contacts.map(c => c.phone).filter(Boolean);

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
        
        const messageBody = `SOS ALERT from ${profile.name}! I need help. My current location is: ${locationText}`;
        
        const promises = toNumbers.map(number => {
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
    // Vite middleware for development
    if (process.env.NODE_ENV !== 'production') {
        const vite = await createViteServer({
            server: { middlewareMode: true },
            appType: 'spa',
        });
        app.use(vite.middlewares);
    } else {
        const distPath = path.join(process.cwd(), 'dist');
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
            res.sendFile(path.join(distPath, 'index.html'));
        });
    }

    app.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
}

startServer();
