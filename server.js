const express = require('express');
const cors = require('cors');
const OpenAI = require('openai');
const Airtable = require('airtable');
require('dotenv').config();

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Clients
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

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
            // next: { revalidate: 3600 } // Note: This Next.js option is ignored in Node.js fetch, but kept per request
        });
        const data = await response.json();

        // Turns your 200 rows into a simple list for the AI to "read"
        return data.records.map((r) => (
            `Gym: ${r.fields['Gym Name']} | Location: ${r.fields['City/Region']} | Price: ${r.fields['Prices']}`
        )).join('\n');
    } catch (error) {
        // ONLY use a fallback if the Airtable connection breaks
        return "I'm currently updating my verified gym list. Please check back in a moment!";
    }
}

// API Key Validation (Optional check)
const hasApiKeys = () => {
    return process.env.OPENAI_API_KEY && process.env.AIRTABLE_API_KEY && process.env.AIRTABLE_BASE_ID;
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

        // 2. Call OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `Role: You are the Fightlore Scout, a personal fight concierge. Your job is to help users find the perfect Muay Thai or Boxing gym in Thailand. You speak with "boots-on-the-ground" authority because you have personally visited every gym you recommend.

Core Knowledge (Verified Gyms): You only provide deep details for gyms in your "Verified List."

Here is your Verified List (Data fetched live):
${dynamicKnowledge}

Interaction Rules:

Be Honest: If a gym doesn't have AC (like Highland), say so. Users trust you because you tell the truth.

Handle Unknowns (The Sales Pitch): If a user asks about a gym NOT on your list, or asks for data you haven't unlocked yet, say:

"I haven't hand-verified that spot yet! I'm currently on the ground scouting 5 new gyms every week to ensure the pricing and quality are real. To see my full 'Black Book' of scout notes and locked prices, you should grab a Fightlore+ Pass."

Pivoting: If they ask a random question (like "Where to eat?"), give a short answer based on "Nearby Amenities" and then bring it back to training.

The VIP Hook: If a user sounds overwhelmed about logistics, mention: "If you want me to handle the Thai-language booking and confirm mat space for you, I can do that through our VIP Concierge service."

Tone: Helpful, expert, slightly "insider," and encouraging. Use Thai greetings like "Sawadee Krap" occasionally.`
                },
                { role: "user", content: message },
            ],
            // Note: Streaming is disabled to maintain compatibility with current frontend
        });

        const reply = completion.choices[0].message.content;

        res.json({ response: reply });

    } catch (error) {
        console.error('Error processing chat request:', error);
        res.status(500).json({ error: 'Internal Server Error' });
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

app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    console.log('Environment variables loaded:', hasApiKeys() ? 'Yes' : 'No (Please configure .env)');
});
