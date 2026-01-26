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

// Gym Data Cache
let cachedGyms = null;
let lastFetchTime = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

// Helper: Fetch Gyms from Airtable (Direct API)
// Helper: Fetch Gyms from Airtable (Direct API)
async function getGymKnowledge() {
    const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME}`;

    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        const data = await response.json();

        if (!response.ok) {
            console.error(`❌ API ERROR: ${response.status} ${response.statusText}`);
            console.error("DETAILS:", JSON.stringify(data, null, 2));
            throw new Error(`Airtable API returned ${response.status}`);
        }

        if (data.records) {
            console.log(`✅ SUCCESS: Loaded ${data.records.length} gyms from Airtable.`);

            // DEBUG: Log the first record's fields to see the schema
            if (data.records.length > 0) {
                console.log("👀 SCHEMA CHECK (First Record):", JSON.stringify(data.records[0].fields, null, 2));
            }

            return data.records.map((r) => {

                let price = r.fields['Prices'];
                // Clean up if it's an ID or array (common in Airtable linked records)
                if (Array.isArray(price)) price = "Contact for details";
                if (typeof price === 'string' && price.startsWith('rec')) price = "Contact for details";
                if (!price) price = "Contact for details";

                return `Gym: ${r.fields['Gym Name']} | Location: ${r.fields['City/Region']} | Price: ${price}`;
            }).join('\n');
        }
    } catch (error) {
        console.error("❌ FETCH FAILURE:", error.message);
        return "I'm currently updating my verified gym list. Please check back in a moment!";
    }
}

// API Key Validation (Optional check)
const hasApiKeys = () => {
    return process.env.GOOGLE_API_KEY && process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID;
};

// Endpoint: Get All Gyms (Structured Data for Frontend)
app.get('/api/gyms', async (req, res) => {
    try {
        const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME}`;
        const response = await fetch(url, { headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` } });
        const data = await response.json();

        if (data.records) {
            const gyms = data.records.map(r => {
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

                return {
                    id: r.id,
                    name: f['Gym Name'],
                    location: f['City/Region'],
                    price: f['Prices'],
                    description: generatedDesc,
                    training: trainingText,
                    accommodation: accomText,
                    rating: parseFloat(calculatedRating),
                    ...f
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
    const { message } = req.body;

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
        // 1. Get Context
        const dynamicKnowledge = await getGymKnowledge();

        console.log("\n--- 🔍 DEBUG: AI Knowledge Base (from Airtable) ---");
        console.log(dynamicKnowledge || "No gyms found or Airtable error.");
        console.log("---------------------------------------------------\n");

        // 2. Call Google Gemini
        if (!genAI) {
            throw new Error("Gemini API not initialized");
        }

        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction: `Role: You are the Fightlore Scout. Help users find Muay Thai gyms in Thailand.

CONTEXT:
Verified Gyms List:
\${dynamicKnowledge}

RULES:
1. CONCISE: Be short and helpful. Max 3 sentences.
2. NO GREETINGS: Do NOT say "Sawadee Krap", "Hello", or "I'd be happy to help". Jump straight to the answer.
3. RECOMMENDATIONS: Use the provided context to recommend gyms. 
4. GYM WRAPPER: If you suggest a gym name, you MUST wrap it in triple pipes like this: |||Sitsarawatseur|||. This is critical for the UI to link the gym card.
5. NO MATCH: If no gym matches the user's criteria, suggest the closest one or tell them to check back as we add new gyms weekly.
6. PRICING: If the prices field contains an ID or "Contact us", tell the user to contact the gym directly for the 2026 rates.

FORMAT EXAMPLE:
"|||Sitsarawatseur||| is a great traditional option in Bangkok. It's budget-friendly and open to all skill levels."`
        });

        const result = await model.generateContent(message);
        const reply = await result.response.text();

        res.json({ response: reply });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
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
        await airtableBase('Waitlist').create([
            {
                "fields": {
                    "Name": name || '',
                    "Email": email,
                    "Date": new Date().toISOString()
                }
            }
        ]);
        console.log(`✅ Added to waitlist: \${name || 'Anonymous'} (\${email})`);
        res.json({ success: true, message: "Added to Waitlist" });
    } catch (error) {
        console.error('❌ Waitlist error:', error);
        res.status(500).json({ error: 'Failed to join waitlist' });
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
            success_url: `${clientUrl}/index.html?success=true`,
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
