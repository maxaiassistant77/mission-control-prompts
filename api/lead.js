// Emergency lead capture - Supabase backup (always saves) + GHL (when key works)

const GHL_API_KEY = process.env.GHL_API_KEY || 'pit-b1f81d50-c314-44de-b9cb-2f092cdde593';
const GHL_LOCATION_ID = 'QFjnAi2H2A9Cpxi7l0ri';
const SUPABASE_URL = 'https://xyvlhjbmpvvczjphqwyf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

export default async function handler(req, res) {
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

    // Phone validation - reject obvious fakes
    if (phone) {
      const digits = phone.replace(/\D/g, '');
      const uniqueDigits = new Set(digits).size;
      const isUS = phone.startsWith('+1') || phone.startsWith('1');
      const usDigits = isUS ? digits.replace(/^1/, '') : null;
      if (digits.length < 7 || uniqueDigits <= 3 || (isUS && usDigits && usDigits.length !== 10)) {
        return res.status(400).json({ error: 'Please enter a valid phone number' });
      }
    }

    const leadSource = source || 'mission-control-prompts';
    let supabaseSaved = false;
    let ghlSaved = false;

    // 1. ALWAYS save to Supabase first (our backup)
    if (SUPABASE_KEY) {
      try {
        const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/captured_leads`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify({ name, email, phone: phone || null, source: leadSource, synced_to_ghl: false }),
        });
        supabaseSaved = sbRes.ok;
        if (!sbRes.ok) console.error('Supabase error:', sbRes.status, await sbRes.text());
      } catch (e) {
        console.error('Supabase error:', e);
      }
    }

    // 2. Try GHL (may fail if key is expired)
    if (GHL_API_KEY) {
      try {
        const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({
            name, email, phone: phone || undefined,
            tags: ['OpenClaw Prompt List'],
            source: leadSource,
            locationId: GHL_LOCATION_ID,
          }),
        });
        if (ghlRes.ok) {
          ghlSaved = true;
          // Mark as synced in Supabase
          if (supabaseSaved && SUPABASE_KEY) {
            await fetch(`${SUPABASE_URL}/rest/v1/captured_leads?email=eq.${encodeURIComponent(email)}&synced_to_ghl=eq.false`, {
              method: 'PATCH',
              headers: {
                'apikey': SUPABASE_KEY,
                'Authorization': `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ synced_to_ghl: true }),
            });
          }
        } else {
          console.error('GHL error:', ghlRes.status);
        }
      } catch (e) {
        console.error('GHL error:', e);
      }
    }

    // Always return success to the user - we saved it somewhere
    if (supabaseSaved || ghlSaved) {
      return res.status(200).json({ success: true });
    }

    // Last resort: log to Vercel logs
    console.error('LEAD_BACKUP:', JSON.stringify({ name, email, phone, source: leadSource, ts: new Date().toISOString() }));
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('CRITICAL:', JSON.stringify(req.body), err);
    return res.status(200).json({ success: true });
  }
}
