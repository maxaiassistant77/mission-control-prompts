// Vercel Serverless Function: POST /api/lead
// Sends lead data directly to GoHighLevel, replacing n8n webhook
// Set GHL_API_KEY in Vercel Environment Variables

const GHL_API_KEY = process.env.GHL_API_KEY || 'pit-4dd367f5-15f7-46f4-acaa-2c36184066f1';
const GHL_LOCATION_ID = 'QFjnAi2H2A9Cpxi7l0ri';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { name, email, phone, source, ts } = req.body || {};

    if (!name || !email) {
      return res.status(400).json({ error: 'Name and email are required' });
    }

    const ghlBody = {
      name,
      email,
      phone: phone || undefined,
      tags: ['OpenClaw Prompt List'],
      source: source || 'mission-control-prompts',
      locationId: GHL_LOCATION_ID,
    };

    const ghlRes = await fetch('https://rest.gohighlevel.com/v1/contacts/', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ghlBody),
    });

    const data = await ghlRes.json();

    if (!ghlRes.ok) {
      console.error('GHL error:', ghlRes.status, data);
      return res.status(502).json({ error: 'Failed to create contact', detail: data });
    }

    return res.status(200).json({ success: true, contactId: data.contact?.id });
  } catch (err) {
    console.error('Lead API error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
