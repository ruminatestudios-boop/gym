# Airtable Configuration Instructions

Follow these steps to connect your waitlist form to Airtable:

## 1. Set Up Airtable

1. Go to [airtable.com](https://airtable.com) and sign in/create account
2. Create a new base or use an existing one
3. Create a table called **"Waitlist"** with these fields:
   - `Name` (Single line text)
   - `Email` (Email)
   - `Submitted At` (Date & time) - optional

## 2. Get Your Airtable Credentials

### Get API Key:
1. Go to [airtable.com/account](https://airtable.com/account)
2. Click "Generate API key" if you don't have one
3. Copy your API key

### Get Base ID:
1. Go to [airtable.com/api](https://airtable.com/api)
2. Select your base
3. In the URL or documentation, find the Base ID (starts with `app...`)

## 3. Configure Environment Variables

Create a `.env` file in your project directory (`/Users/pritesh/Documents/GitHub/gym/.env`) with:

```
AIRTABLE_API_KEY=your_api_key_here
AIRTABLE_BASE_ID=your_base_id_here
AIRTABLE_TABLE_NAME=Waitlist
PORT=3000
```

## 4. Install Dependencies

Run in terminal:
```bash
cd /Users/pritesh/Documents/GitHub/gym
npm install
```

## 5. Start the Server

```bash
npm start
```

You should see: `🚀 Server running on http://localhost:3000`

## 6. Test the Form

1. Open `index.html` in your browser
2. Fill out the waitlist form
3. Check your Airtable base - the entry should appear!

## Troubleshooting

- **"Network error"**: Make sure the server is running (`npm start`)
- **"Failed to save"**: Check your Airtable credentials in `.env`
- **CORS errors**: Server already has CORS enabled, but check browser console
