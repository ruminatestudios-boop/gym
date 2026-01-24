require('dotenv').config({ path: '/Users/pritesh/Documents/GitHub/gym/.env' });
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

async function checkVideos() {
    const records = await base(process.env.AIRTABLE_TABLE_NAME).select().all();

    console.log('\n📹 Checking Video URLs:\n');
    records.forEach(record => {
        const gymName = record.fields['Gym Name'] || 'Unknown';
        const videoUrl = record.fields['Primary Video URL'] || 'NO URL';
        console.log(`${gymName}: ${videoUrl}`);
    });
}

checkVideos().catch(console.error);
