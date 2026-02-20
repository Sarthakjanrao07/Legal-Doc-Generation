import { NextRequest, NextResponse } from 'next/server'

const LEGAL_SERVICE_PORT = 3002

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    
    const response = await fetch(`http://localhost:${LEGAL_SERVICE_PORT}/conversation/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error starting conversation:', error)
    return NextResponse.json(
      { error: 'Failed to start conversation' },
      { status: 503 }
    )
  }
}
