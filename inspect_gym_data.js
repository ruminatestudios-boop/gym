require('dotenv').config();

const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_TABLE_NAME}`;

async function fetchGyms() {
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        const data = await response.json();

        if (data.records && data.records.length > 0) {
            console.log("✅ API Success. Found", data.records.length, "gyms.");
            const fields = data.records[0].fields;
            console.log("🔑 ALL FIELD NAMES:");
            console.log(Object.keys(fields).sort());

            // Also print data for the specific gyms we care about to manually calculate if needed
            const targetGyms = ["Kiatsongkrit", "Pinsinchai", "Kiatphontip"];
            console.log("\n🏋️ TARGET GYM DATA:");
            data.records.forEach(r => {
                const name = r.fields['Gym Name'];
                if (targetGyms.some(t => name.includes(t))) {
                    console.log(`\nName: ${name}`);
                    // Print all fields containing 'Stars' or 'Rating'
                    Object.keys(r.fields).forEach(key => {
                        if (key.includes('Stars') || key.includes('Rating')) {
                            console.log(`  ${key}: ${r.fields[key]}`);
                        }
                    });
                }
            });
        } else {
            console.log("❌ No records found.");
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

fetchGyms();
