const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Airtable = require('airtable');
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.')); // Serve frontend files from root

// Initialize Clients
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

const airtableBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);
const tableName = process.env.AIRTABLE_TABLE_NAME || 'Gyms';

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
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            systemInstruction: `Role: You are the Fightlore Scout. Help users find gyms in Thailand.

CONTEXT:
Verified Gyms List:
${dynamicKnowledge}

RULES:
1. CONCISE: Be short. No fluff. Max 2-3 sentences.
2. NO GREETINGS: Do NOT say "Sawadee Krap" or "Hello". Jump straight to the answer.
3. FORMAT: If you suggest a gym, must WRAP the name in triple pipes like this: |||Sitsarawatseur|||.
   Example: "Sitsarawatseur is a great traditional option. |||Sitsarawatseur|||"

RESPONSE:
- Direct answer.
- If ID found in price, say "Contact us".`
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
        res.json({ success: true, message: "Added to Waitlist" });
    } catch (error) {
        console.error('Airtable Error:', error);
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
