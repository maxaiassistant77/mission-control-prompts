import { NextRequest, NextResponse } from 'next/server';

// Environment variables
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const GHL_API_KEY = process.env.GHL_API_KEY || 'pit-5e298b3d-a0c2-4612-b583-731fbd24711d';
const GHL_LOCATION_ID = 'QFjnAi2H2A9Cpxi7l0ri';
const SUPABASE_URL = 'https://xyvlhjbmpvvczjphqwyf.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

interface Lead {
  id: number;
  name: string;
  email: string;
  phone?: string;
  source: string;
  synced_to_ghl: boolean;
  notes?: string;
  created_at: string;
}

interface SyncResult {
  success: number;
  errors: number;
  total: number;
  details: Array<{
    id: number;
    email: string;
    status: 'success' | 'error';
    error?: string;
  }>;
}

export async function POST(request: NextRequest) {
  console.log('Admin sync-ghl endpoint called');
  
  try {
    // 1. Authentication check - Bearer token validation
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('Missing or invalid authorization header');
      return NextResponse.json(
        { error: 'Unauthorized - Missing Bearer token' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    if (!ADMIN_SECRET || token !== ADMIN_SECRET) {
      console.log('Invalid admin secret provided');
      return NextResponse.json(
        { error: 'Unauthorized - Invalid token' },
        { status: 401 }
      );
    }

    // 2. Validate required environment variables
    if (!SUPABASE_KEY) {
      console.error('SUPABASE_SERVICE_KEY not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    if (!GHL_API_KEY) {
      console.error('GHL_API_KEY not configured');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    console.log('Starting sync process for unsynced leads...');

    let totalProcessed = 0;
    let totalSuccess = 0;
    let totalErrors = 0;
    let allDetails: SyncResult['details'] = [];
    let offset = 0;
    const batchSize = 50;

    // 3. Process leads in batches to avoid timeouts
    while (true) {
      try {
        // Fetch batch of unsynced leads from Supabase
        console.log(`Fetching batch ${Math.floor(offset / batchSize) + 1} (offset: ${offset}, limit: ${batchSize})`);
        
        const supabaseResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/captured_leads?synced_to_ghl=eq.false&order=created_at.asc&limit=${batchSize}&offset=${offset}`,
          {
            method: 'GET',
            headers: {
              'apikey': SUPABASE_KEY,
              'Authorization': `Bearer ${SUPABASE_KEY}`,
              'Content-Type': 'application/json',
            },
          }
        );

        if (!supabaseResponse.ok) {
          const errorText = await supabaseResponse.text();
          console.error('Failed to fetch leads from Supabase:', supabaseResponse.status, errorText);
          throw new Error(`Supabase fetch failed: ${supabaseResponse.status}`);
        }

        const leads: Lead[] = await supabaseResponse.json();
        console.log(`Found ${leads.length} unsynced leads in this batch`);

        // If no more leads, break the loop
        if (leads.length === 0) {
          console.log('No more unsynced leads found');
          break;
        }

        // 4. Process each lead in the batch
        for (const lead of leads) {
          totalProcessed++;
          console.log(`Processing lead ${totalProcessed}: ${lead.email}`);

          try {
            // Sync to GoHighLevel
            const ghlResponse = await fetch('https://services.leadconnectorhq.com/contacts/', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${GHL_API_KEY}`,
                'Content-Type': 'application/json',
                'Version': '2021-07-28',
              },
              body: JSON.stringify({
                name: lead.name,
                email: lead.email,
                phone: lead.phone || undefined,
                tags: ['OpenClaw Prompt List'],
                source: lead.source,
                locationId: GHL_LOCATION_ID,
              }),
            });

            if (ghlResponse.ok) {
              // Successfully synced to GHL - update Supabase
              console.log(`Successfully synced ${lead.email} to GHL`);
              
              const updateResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/captured_leads?id=eq.${lead.id}`,
                {
                  method: 'PATCH',
                  headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    synced_to_ghl: true,
                    notes: lead.notes ? `${lead.notes}\nSynced to GHL on ${new Date().toISOString()}` : `Synced to GHL on ${new Date().toISOString()}`
                  }),
                }
              );

              if (!updateResponse.ok) {
                console.error(`Failed to update lead ${lead.id} in Supabase:`, updateResponse.status);
              }

              totalSuccess++;
              allDetails.push({
                id: lead.id,
                email: lead.email,
                status: 'success'
              });

            } else {
              // Failed to sync to GHL - log error and update notes
              const errorText = await ghlResponse.text();
              const errorMessage = `GHL sync failed (${ghlResponse.status}): ${errorText}`;
              console.error(`Failed to sync ${lead.email} to GHL:`, errorMessage);

              // Update notes with error information
              await fetch(
                `${SUPABASE_URL}/rest/v1/captured_leads?id=eq.${lead.id}`,
                {
                  method: 'PATCH',
                  headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    notes: lead.notes ? `${lead.notes}\nSync error on ${new Date().toISOString()}: ${errorMessage}` : `Sync error on ${new Date().toISOString()}: ${errorMessage}`
                  }),
                }
              );

              totalErrors++;
              allDetails.push({
                id: lead.id,
                email: lead.email,
                status: 'error',
                error: errorMessage
              });
            }

          } catch (error) {
            // Handle individual lead processing errors
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`Error processing lead ${lead.email}:`, errorMessage);

            // Update notes with error information
            try {
              await fetch(
                `${SUPABASE_URL}/rest/v1/captured_leads?id=eq.${lead.id}`,
                {
                  method: 'PATCH',
                  headers: {
                    'apikey': SUPABASE_KEY,
                    'Authorization': `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    notes: lead.notes ? `${lead.notes}\nSync error on ${new Date().toISOString()}: ${errorMessage}` : `Sync error on ${new Date().toISOString()}: ${errorMessage}`
                  }),
                }
              );
            } catch (updateError) {
              console.error(`Failed to update lead notes for ${lead.email}:`, updateError);
            }

            totalErrors++;
            allDetails.push({
              id: lead.id,
              email: lead.email,
              status: 'error',
              error: errorMessage
            });
          }
        }

        // Move to next batch
        offset += batchSize;

        // If we got fewer leads than batch size, we're done
        if (leads.length < batchSize) {
          console.log('Reached end of leads (partial batch)');
          break;
        }

      } catch (batchError) {
        console.error(`Error processing batch at offset ${offset}:`, batchError);
        break;
      }
    }

    // 5. Return comprehensive summary
    const result: SyncResult = {
      success: totalSuccess,
      errors: totalErrors,
      total: totalProcessed,
      details: allDetails
    };

    console.log(`Sync complete: ${totalSuccess} successful, ${totalErrors} errors, ${totalProcessed} total processed`);

    return NextResponse.json({
      message: 'Sync process completed',
      completed: true,
      timestamp: new Date().toISOString(),
      results: result
    }, { status: 200 });

  } catch (error) {
    console.error('Critical error in sync-ghl endpoint:', error);
    
    return NextResponse.json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
      completed: false,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// Prevent GET and other methods
export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405 }
  );
}
