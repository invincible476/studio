import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const searchTerm = searchParams.get('q');
  const apiKey = process.env.NEXT_PUBLIC_TENOR_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: 'Tenor API key is not configured.' }, { status: 500 });
  }

  const searchUrl = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(
    searchTerm || ''
  )}&key=${apiKey}&limit=20&media_filter=tinygif`;
  
  const trendingUrl = `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=20&media_filter=tinygif`;

  const url = searchTerm ? searchUrl : trendingUrl;

  try {
    const tenorResponse = await fetch(url);
    if (!tenorResponse.ok) {
      const errorBody = await tenorResponse.text();
      console.error("Tenor API Error:", errorBody);
      return NextResponse.json({ error: `Tenor API error: ${tenorResponse.statusText}` }, { status: tenorResponse.status });
    }
    const data = await tenorResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching from Tenor API:', error);
    return NextResponse.json({ error: 'Failed to fetch GIFs from Tenor.' }, { status: 500 });
  }
}
