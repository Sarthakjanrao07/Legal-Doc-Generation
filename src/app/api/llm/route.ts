import { NextRequest, NextResponse } from 'next/server'

// ============================================================================
// LLM API Route - Groq API Only
// ============================================================================
// Set GROQ_API_KEY in your Vercel environment variables

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.1-8b-instant'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { messages } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Messages array is required' 
      }, { status: 400 })
    }

    // Check for API key
    const apiKey = process.env.GROQ_API_KEY
    if (!apiKey) {
      return NextResponse.json({ 
        success: false, 
        error: 'GROQ_API_KEY environment variable is not set. Please add it in Vercel Dashboard > Settings > Environment Variables.' 
      }, { status: 500 })
    }

    // Add strict system prompt if not present
    const messagesWithSystem = messages[0]?.role === 'system' 
      ? messages 
      : [
          { 
            role: 'system', 
            content: `You are a legal document drafting assistant. CRITICAL RULES:
1. NEVER use placeholders like [Name], [Address], [Date]
2. Only use information explicitly provided by the user
3. Be concise and professional
4. Return only valid JSON when requested
5. Never add information not provided
6. When extracting data, return clean properly formatted values
7. For names, use proper capitalization (e.g., "John Smith")` 
          },
          ...messages
        ]

    // Call Groq API
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: messagesWithSystem,
        temperature: 0.3,
        max_tokens: 2048,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`Groq API error (${response.status}):`, errorText)
      
      return NextResponse.json({ 
        success: false, 
        error: `Groq API error: ${response.status}. Please check your API key is valid.` 
      }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content

    if (!content) {
      return NextResponse.json({ 
        success: false, 
        error: 'No response content from Groq API' 
      }, { status: 500 })
    }

    return NextResponse.json({ 
      success: true, 
      response: content 
    })

  } catch (error) {
    console.error('LLM API Error:', error)
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 })
  }
}
