import { NextRequest, NextResponse } from 'next/server'

const LEGAL_SERVICE_PORT = 3002

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ session_id: string }> }
) {
  try {
    const { session_id } = await params
    
    const response = await fetch(
      `http://localhost:${LEGAL_SERVICE_PORT}/document/generate-from-session/${session_id}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error generating document:', error)
    return NextResponse.json(
      { error: 'Failed to generate document' },
      { status: 503 }
    )
  }
}
