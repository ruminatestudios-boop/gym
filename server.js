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

// Helper: Fetch Gyms from Airtable
async function fetchGymData() {
    const now = Date.now();
    if (cachedGyms && (now - lastFetchTime < CACHE_DURATION)) {
        return cachedGyms;
    }

    try {
        const records = await airtableBase(tableName).select({
            maxRecords: 50,
            view: "Grid view" // Adjust if needed
        }).all();

        const gyms = records.map(record => {
            // Adjust these field names to match your actual Airtable columns
            return {
                name: record.get('Name') || record.get('Gym Name'),
                location: record.get('Location') || record.get('City'),
                style: record.get('Style') || record.get('Focus'),
                description: record.get('Description') || record.get('Notes'),
                price: record.get('Price') || record.get('Drop-in'),
            };
        });

        cachedGyms = JSON.stringify(gyms);
        lastFetchTime = now;
        console.log(`Fetched ${gyms.length} gyms from Airtable.`);
        return cachedGyms;
    } catch (error) {
        console.error("Error fetching from Airtable:", error);
        return null;
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
        const gymContext = await fetchGymData();
        const systemPrompt = `
You are an expert Muay Thai scout in Thailand. 
You have verified data on the following gyms: 
${gymContext || "No gym data available currently."}

Answer the user's question by recommending the best match from this list. 
Be concise, honest, and helpful. 
If the user asks about something not in the list, you can provide general Thailand training advice but mention you only have verified data on the listed gyms.
`;

        // 2. Call OpenAI
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: message },
            ],
            max_tokens: 300,
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
