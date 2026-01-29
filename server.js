const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Airtable = require('airtable');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve frontend files from root

// Initialize Clients
const getRequiredEnv = (name) => {
    const val = process.env[name];
    if (!val) {
        console.error(`❌ MISSING ENV VAR: ${name}`);
        return null;
    }
    return val;
};

const GOOGLE_API_KEY = getRequiredEnv('GOOGLE_API_KEY');
const AIRTABLE_API_KEY = getRequiredEnv('AIRTABLE_API_KEY');
const AIRTABLE_BASE_ID = getRequiredEnv('AIRTABLE_BASE_ID');
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Gyms';

const genAI = GOOGLE_API_KEY ? new GoogleGenerativeAI(GOOGLE_API_KEY) : null;
const airtableBase = (AIRTABLE_API_KEY && AIRTABLE_BASE_ID)
    ? new Airtable({ apiKey: AIRTABLE_API_KEY }).base(AIRTABLE_BASE_ID)
    : null;

const WAITLIST_TABLE = process.env.AIRTABLE_WAITLIST_TABLE || 'Waitlist';

// Gym Data Cache
let cachedGyms = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

async function getGymKnowledge() {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME}`;

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        const data = await response.json();

        if (!response.ok) {
            console.error(`❌ API ERROR: ${response.status} ${response.statusText}`);
            throw new Error(`Airtable API returned ${response.status}`);
        }

        if (data.records) {
            const gymNames = [];
            const contextStrings = data.records.map((r) => {
                const f = r.fields;
                const name = f['Gym Name'] || 'Unknown Gym';

                // Collect gym names for the NO MATCH rule
                if (name !== 'Unknown Gym') {
                    gymNames.push(name);
                }

                // Build context string dynamically from ALL fields
                let context = `Gym: ${name}`;

                // Iterate through all fields and add them to context
                for (const [key, value] of Object.entries(f)) {
                    // Skip the gym name since we already added it
                    if (key === 'Gym Name') continue;

                    // Handle different value types
                    let formattedValue = value;

                    // Arrays (like multi-select fields)
                    if (Array.isArray(value)) {
                        // Check if it's an array of objects (linked records)
                        if (value.length > 0 && typeof value[0] === 'object') {
                            formattedValue = "Contact for details";
                        } else {
                            formattedValue = value.join(', ');
                        }
                    }
                    // Objects (like attachments or linked records)
                    else if (typeof value === 'object' && value !== null) {
                        formattedValue = "Contact for details";
                    }
                    // Strings that look like record IDs
                    else if (typeof value === 'string' && value.startsWith('rec')) {
                        formattedValue = "Contact for details";
                    }

                    // Add to context if we have a valid value
                    if (formattedValue && formattedValue !== '') {
                        context += ` | ${key}: ${formattedValue}`;
                    }
                }

                return context;
            });

            return {
                context: contextStrings.join('\n---\n'),
                gymNames: gymNames
            };
        }
    } catch (error) {
        console.error("❌ FETCH FAILURE:", error.message);
        return {
            context: "I'm currently updating my verified gym list. Please check back in a moment!",
            gymNames: []
        };
    }
}

// API Key Validation (Optional check)
const hasApiKeys = () => {
    return process.env.GOOGLE_API_KEY && process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID;
};

// Helper: Generic Airtable Fetch (Non-paginated for simplicity, max 100 records)
async function fetchAirtableTable(tableName) {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${tableName}`;
    try {
        const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
        const data = await response.json();
        if (!response.ok) throw new Error(`Airtable API Error: ${response.statusText}`);
        return data.records || [];
    } catch (error) {
        console.error(`❌ Failed to fetch table '${tableName}':`, error);
        return [];
    }
}

// Endpoint: Get All Gyms (Structured Data for Frontend)
app.get('/api/gyms', async (req, res) => {
    try {
        const [gymRecords, priceRecords] = await Promise.all([
            fetchAirtableTable(process.env.AIRTABLE_TABLE_NAME || 'Gyms'),
            fetchAirtableTable('Prices')
        ]);

        // Create Price Lookup Map: Record ID -> { Name, Price }
        const priceMap = {};
        priceRecords.forEach(r => {
            const f = r.fields;
            // Assuming columns are "Name" and "Prices (THB)" based on screenshot
            // Use fallback keys if needed
            const name = f['Name'] || f['Item'] || 'Drop-in';
            const cost = f['Prices (THB)'] || f['Price'] || f['Cost'];
            if (cost) {
                // Format: "1 Time: 350" (add THB in frontend or here?)
                // Let's format it nicely here: "1 Time: 350 THB"
                // Format number with commas?
                const formattedCost = typeof cost === 'number'
                    ? cost.toLocaleString()
                    : cost;
                priceMap[r.id] = `${name}: ${formattedCost} THB`;
            }
        });

        if (gymRecords) {
            const gyms = gymRecords.map(r => {
                const f = r.fields;

                let generatedDesc = f['Description'] || f['Notes'];
                if (!generatedDesc) {
                    const vibe = f['Gym Atmosphere'] ? f['Gym Atmosphere'].join(', ') : 'Authentic';
                    const levels = f['Best For (Level)'] ? f['Best For (Level)'].join(' and ') : 'all levels';
                    const owner = f['Gym Owner'] ? `Owned by ${f['Gym Owner'].trim()}.` : '';
                    generatedDesc = `${f['Gym Name']} offers a ${vibe} atmosphere in ${f['City/Region']}. Perfect for ${levels}. ${owner}`;
                }

                let accomText = f['Accommodation'] || "Contact for accommodation details.";
                if (f['On-site Accommodation'] === 'Yes') {
                    const amenities = [];
                    if (f['Kitchen Access'] === 'Yes') amenities.push("Kitchen Access");
                    if (f['Air Conditioning'] === 'Yes') amenities.push("Air Conditioning");
                    else if (f['Fans'] === 'Yes') amenities.push("Fan Rooms");
                    accomText = `On-site accommodation available. ${amenities.length ? 'Includes: ' + amenities.join(', ') + '.' : ''}`;
                } else if (f['On-site Accommodation'] === 'No') {
                    accomText = "No on-site rooms, but many hotels nearby.";
                }

                let trainingText = f['Training Programs'] || f['Training Style'];
                if (!trainingText) {
                    trainingText = f['Skill Level Welcome'] ? f['Skill Level Welcome'].join(', ') : 'All Levels, Muay Thai';
                }

                const trainerExp = f['Trainer Experience Level'] ? ` Trainers are ${f['Trainer Experience Level'].toLowerCase()}.` : '';
                if (!generatedDesc.includes('Trainer')) {
                    generatedDesc += trainerExp;
                }

                const ratingFields = [
                    'Overall Rating',
                    'Cleanliness Rating',
                    'Trainer Quality Rating',
                    'Value for Money Rating',
                    'Beginner Friendliness',
                    'Tourist-Friendly Score'
                ];

                const ratings = ratingFields
                    .map(field => f[field])
                    .filter(val => val !== undefined && val !== null && typeof val === 'number');

                const calculatedRating = ratings.length > 0
                    ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1)
                    : 4.8;

                // Enroll Prices
                let resolvedPrices = [];
                const priceField = f['Prices']; // This is usually an array of IDs
                if (Array.isArray(priceField)) {
                    resolvedPrices = priceField.map(id => priceMap[id]).filter(Boolean);
                } else if (typeof priceField === 'string' && !priceField.startsWith('rec')) {
                    // It's a hardcoded string
                    resolvedPrices = [priceField];
                }

                return {
                    ...f, // Spread raw fields first
                    id: r.id,
                    name: f['Gym Name'],
                    location: f['City/Region'],
                    email: f['E-Mail'] || f['Email'] || f['Email Address'] || null,
                    price: resolvedPrices.length > 0 ? resolvedPrices : null,
                    Prices: resolvedPrices.length > 0 ? resolvedPrices : null, // Override raw IDs with resolved content
                    description: generatedDesc,
                    training: trainingText,
                    accommodation: accomText,
                    rating: parseFloat(calculatedRating)
                };
            });
            res.json({ gyms });
        } else {
            res.json({ gyms: [] });
        }
    } catch (error) {
        console.error("❌ API ERROR:", error);
        res.status(500).json({ error: "Failed to fetch gyms" });
    }
});

// Endpoint: Dynamic Gym Traffic Status
app.get('/api/gym-status', (req, res) => {
    // Get current time in Bangkok (UTC+7)
    const now = new Date();
    const bkkTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
    const day = bkkTime.getUTCDay(); // 0-6 (Sun-Sat)
    const hour = bkkTime.getUTCHours(); // 0-23

    let level = "Low Traffic";
    let color = "emerald";

    // Most gyms are closed on Sundays
    if (day === 0) {
        level = "Closed Today";
        color = "zinc";
    } else {
        // Morning Peak: 7am - 9am
        if (hour >= 7 && hour < 10) {
            level = "Busy (Morning Session)";
            color = "red";
        }
        // Afternoon Peak: 4pm - 7pm
        else if (hour >= 16 && hour < 19) {
            level = "Live: Busy";
            color = "red";
        }
        // Moderate: 9am - 11am, 3pm - 4pm, 7pm - 8pm
        else if ((hour >= 10 && hour < 12) || (hour >= 15 && hour < 16) || (hour >= 19 && hour < 20)) {
            level = "Live: Moderate";
            color = "yellow";
        }
        // Night: Closed after 8pm
        else if (hour >= 20 || hour < 7) {
            level = "Closed Now";
            color = "zinc";
        }
        // Otherwise Low
        else {
            level = "Live: Low Traffic";
            color = "emerald";
        }
    }

    res.json({
        time: bkkTime.toISOString(),
        hour: hour,
        status: level,
        color: color,
        statuses: [
            { text: "Live: Low Traffic", color: "text-emerald-400", dot: "bg-emerald-500", ping: "bg-emerald-400" },
            { text: "Live: Moderate", color: "text-yellow-400", dot: "bg-yellow-500", ping: "bg-yellow-400" },
            { text: "Live: Busy", color: "text-red-400", dot: "bg-red-500", ping: "bg-red-400" },
            { text: "Closed Now", color: "text-zinc-500", dot: "bg-zinc-600", ping: "bg-zinc-500" }
        ]
    });
});

// Chat Endpoint
app.post('/api/chat', async (req, res) => {
    const { message, conversationHistory = [] } = req.body;

    if (!message) {
        return res.status(400).json({ error: 'Message is required' });
    }

    if (!hasApiKeys()) {
        return res.json({
            useMock: true,
            message: "Backend is running but API keys are not configured in .env. Using mock data."
        });
    }

    try {
        // 1. Get Context and Gym Names
        const gymData = await getGymKnowledge();
        const { context: dynamicKnowledge, gymNames } = gymData;

        console.log("\n--- 🔍 DEBUG: AI Knowledge Base (from Airtable) ---");
        console.log(dynamicKnowledge || "No gyms found or Airtable error.");
        console.log("---------------------------------------------------\n");

        // 2. Generate dynamic gym pills for NO MATCH rule
        const gymPills = gymNames.map(name => `|||${name}|||`).join(' ');

        // 3. Build conversation context
        let conversationContext = '';
        if (conversationHistory.length > 0) {
            conversationContext = '\n\nPREVIOUS CONVERSATION:\n';
            conversationHistory.forEach(msg => {
                const role = msg.role === 'user' ? 'User' : 'Assistant';
                conversationContext += `${role}: ${msg.content}\n`;
            });
        }

        // 4. Call Google Gemini
        if (!genAI) {
            throw new Error("Gemini API not initialized");
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction: `Role: You are the Fightlore Scout. Help users find Muay Thai gyms in Thailand.

CONTEXT:
Verified Gyms List (from our ground scout):
${dynamicKnowledge}${conversationContext}

RULES:
1. ACCURACY: answer questions ONLY using the provided context (Verified Gyms List). 
2. NO MATCH: If a user asks for a gym that is NOT in the Verified Gyms List above, you MUST say exactly: "We are looking to add this gym to the list shortly and our full database. In the meantime, discover one of our verified gyms: ${gymPills}"
3. OFF-TOPIC: If a user asks something completely unrelated to gyms or Muay Thai training (e.g., random words, fighter names, unrelated topics), respond: "I appreciate your question, but I specialize in helping you find the perfect Muay Thai gym in Thailand. Feel free to ask me about gyms, training options, locations, or facilities—I'm here to help!"
4. RELEVANCE: Use the Summary, Details, and Vibe fields to answer specific questions.
5. CONCISE: Be short and helpful. Max 3 sentences.
6. NO GREETINGS: Do NOT say "Sawadee Krap", "Hello", or "I'd be happy to help".
7. GYM_ID: If you suggest a gym name, you MUST wrap it in triple pipes like this: |||Sitsarawatseur|||. This is critical for the UI.
8. CONTEXT AWARENESS: If the user asks a follow-up question (e.g., "What are the hours?"), use the previous conversation to understand which gym they're referring to.`
        });

        const result = await model.generateContent(message);
        const reply = await result.response.text();

        res.json({ response: reply });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Endpoint: Record Booking (Save to Airtable before paying)
app.post('/api/record-booking', async (req, res) => {
    const { name, email, gymName, date, time, trainingType, notes } = req.body;

    if (!name || !email) {
        return res.status(400).json({ error: 'Name and Email are required' });
    }

    if (!airtableBase) {
        return res.status(503).json({ error: 'Airtable connection not configured' });
    }

    try {
        // Attempt to save to 'Bookings' table
        // NOTE: User must create this table in Airtable base!
        await airtableBase('Bookings').create([
            {
                "fields": {
                    "Name": name,
                    "Email": email,
                    "Gym Name": gymName,
                    "Date": date,
                    "Time": time,
                    "Training Type": trainingType,
                    "Notes": notes || ''
                }
            }
        ]);
        console.log(`✅ Booking recorded for: ${name} (${gymName})`);
        res.json({ success: true });
    } catch (error) {
        console.error('❌ Booking Record Error:', error);
        // Fallback: If 'Bookings' table doesn't exist, try 'Waitlist' with notes?
        // For now, just error out so we know to fix Airtable
        res.status(500).json({ error: 'Failed to record booking. Ensure "Bookings" table exists in Airtable.' });
    }
});

// Waitlist Endpoint
app.post('/api/waitlist', async (req, res) => {
    const { email, name } = req.body;

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }

    if (!airtableBase) {
        return res.status(503).json({ error: 'Airtable connection not configured' });
    }

    try {
        console.log(`\n--- 📥 Waitlist Submission: ${name} (${email}) ---`);

        // Try to save to configured table
        await airtableBase(WAITLIST_TABLE).create([
            {
                "fields": {
                    "Name": name || '',
                    "Email": email,
                    "Date": new Date().toISOString().split('T')[0]
                }
            }
        ]);

        console.log(`✅ SUCCESS: Added to Airtable "${WAITLIST_TABLE}" table\n`);
        res.json({ success: true, message: "Added to Waitlist" });
    } catch (error) {
        console.error('❌ Waitlist Error:', error.message);
        console.error('Stack Trace:', error.stack);

        // Detailed error for client
        let errorMsg = error.message;
        if (error.message?.includes('not found')) {
            errorMsg = `Airtable table "${WAITLIST_TABLE}" not found. Check your AIRTABLE_WAITLIST_TABLE env var or create the table.`;
        } else if (error.message?.includes('Unknown field')) {
            errorMsg = `Airtable Schema Mismatch: ${error.message}. Ensure "Name" and "Email" columns exist.`;
        }

        res.status(500).json({
            success: false,
            error: errorMsg || 'Internal Server Error'
        });
    }
});

// Stripe Checkout Endpoint
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

app.post('/api/create-checkout-session', async (req, res) => {
    const { priceType } = req.body;
    const clientUrl = process.env.CLIENT_URL || 'http://localhost:3000';

    // Define products based on type
    let productData = {};
    if (priceType === 'fighter-passport') {
        productData = {
            price_data: {
                currency: 'usd',
                product_data: {
                    name: "Fighter's Passport",
                    description: 'Unlimited AI Finder, Black Book Access & Scam Filter',
                },
                unit_amount: 4700, // $47.00
            }
        };
    } else if (priceType === 'vip-concierge') {
        productData = {
            price_data: {
                currency: 'usd',
                product_data: {
                    name: 'VIP Concierge',
                    description: "Fighter's Passport + Personal Booking Service",
                },
                unit_amount: 14700, // $147.00
            }
        };
    } else if (priceType === 'booking-deposit') {
        productData = {
            price_data: {
                currency: 'usd',
                product_data: {
                    name: 'Gym Booking Deposit',
                    description: 'Secure your session. Includes concierge coordination.',
                },
                unit_amount: 1500, // $15.00
            }
        };
    } else {
        return res.status(400).json({ error: 'Invalid price type' });
    }

    try {
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    ...productData,
                    quantity: 1,
                },
            ],
            mode: 'payment',
            metadata: req.body.metadata || {}, // Pass booking details to Stripe
            success_url: `${clientUrl}/index.html?payment_success=booking`,
            cancel_url: `${clientUrl}/index.html?canceled=true`,
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error("Stripe Error:", e);
        res.status(500).json({ error: e.message });
    }
});

// Health Check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        config: {
            google: !!GOOGLE_API_KEY,
            airtable: !!AIRTABLE_API_KEY && !!AIRTABLE_BASE_ID
        }
    });
});

app.listen(port, async () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Environment variables loaded:', hasApiKeys() ? 'Yes' : 'No (Please configure .env)');

    // Test Airtable Connection on Startup
    console.log("\n--- 🔄 Connecting to Airtable... ---");
    const knowledge = await getGymKnowledge();
    if (typeof knowledge === 'string' && knowledge.startsWith("Gym:")) {
        console.log(`✅ Knowledge Base Loaded (${knowledge.split('\n').length} gyms)`);
    } else {
        console.log("⚠️ Knowledge Base Warning:", knowledge);
    }
    console.log("-----------------------------------------\n");
});
