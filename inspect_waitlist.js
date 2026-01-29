require('dotenv').config();

const url = `https://api.airtable.com/v0/${process.env.AIRTABLE_BASE_ID}/${process.env.AIRTABLE_WAITLIST_TABLE}`;

async function inspectWaitlist() {
    try {
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${process.env.AIRTABLE_API_KEY}` },
        });
        const data = await response.json();

        if (data.records && data.records.length > 0) {
            console.log("✅ API Success. Found", data.records.length, "waitlist entries.");
            const fields = data.records[0].fields;
            console.log("🔑 ALL FIELD NAMES:");
            console.log(Object.keys(fields).sort());
            console.log("📄 EXAMPLE RECORD:", fields);
        } else {
            console.log("❌ No records found or table empty. Raw data:", data);
        }
    } catch (error) {
        console.error("❌ Error:", error.message);
    }
}

inspectWaitlist();
