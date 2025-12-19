import { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
    console.error('========== TEST DEBUG ENDPOINT CALLED ==========');
    console.log('========== TEST DEBUG ENDPOINT CALLED ==========');
    return new Response(JSON.stringify({ 
        message: 'Debug endpoint working',
        timestamp: new Date().toISOString()
    }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
