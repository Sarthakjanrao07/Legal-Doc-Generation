import { NextResponse } from 'next/server'

const LEGAL_SERVICE_PORT = 3002

export async function GET() {
  try {
    const response = await fetch(`http://localhost:${LEGAL_SERVICE_PORT}/documents`, {
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('Error fetching documents:', error)
    return NextResponse.json(
      { error: 'Failed to connect to legal document service' },
      { status: 503 }
    )
  }
}
