require('dotenv').config({ path: '/Users/pritesh/Documents/GitHub/gym/.env' });
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

async function checkFields() {
    const records = await base(process.env.AIRTABLE_TABLE_NAME).select({ maxRecords: 1 }).all();

    console.log('\n📋 All Airtable Field Names:\n');
    if (records.length > 0) {
        const fieldNames = Object.keys(records[0].fields);
        fieldNames.forEach(name => {
            console.log(`  - ${name}`);
        });

        console.log('\n🔍 Looking for video-related fields:\n');
        const videoFields = fieldNames.filter(name => name.toLowerCase().includes('video'));
        videoFields.forEach(name => {
            console.log(`  ✓ ${name}: ${records[0].fields[name] || 'empty'}`);
        });
    }
}

checkFields().catch(console.error);
