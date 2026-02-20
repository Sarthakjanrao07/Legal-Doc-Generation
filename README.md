# Legal Document Generator

A professional legal document generation platform powered by Groq AI. Create wills, power of attorney documents, and more through an intuitive conversational interface.

## Features

- **AI-Powered Drafting**: Uses Groq API (LLaMA 3.1) for intelligent document generation
- **Structured Conversation**: Guided question flow for collecting user information
- **Consistency Checking**: Validates inputs for contradictions and logical errors
- **Guardrails**: Protection against prompt injection, legal advice requests, and vague inputs
- **PDF Generation**: Professional legal document output
- **Multiple Document Types**: Will, Power of Attorney, and more (configurable)

## Tech Stack

- **Framework**: Next.js 16 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS + shadcn/ui
- **AI**: Groq API (LLaMA 3.1)

---

## 🚀 Deploy to Vercel

### Prerequisites
- A [Groq API Key](https://console.groq.com/keys) (FREE tier available)

### Step 1: Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit - Legal Document Generator"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/legal-document-generator.git
git push -u origin main
```

### Step 2: Deploy on Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click **"Add New"** → **"Project"**
3. Import your GitHub repository
4. **IMPORTANT**: Click **"Environment Variables"** before deploying
5. Add this required variable:
   - **Name**: `GROQ_API_KEY`
   - **Value**: `your_groq_api_key_here` (get from https://console.groq.com/keys)
6. Click **"Deploy"**

### Step 3: Done! 🎉

Your app is now live with Groq AI!

---

## 🔑 Get Groq API Key

1. Go to [console.groq.com](https://console.groq.com)
2. Sign up / Log in (FREE tier available)
3. Navigate to **API Keys**
4. Click **Create API Key**
5. Copy the key and add to Vercel environment variables

---

## 💻 Local Development

```bash
# Install dependencies
npm install

# Create .env.local file
cp .env.example .env.local

# Edit .env.local and add your Groq API key
# GROQ_API_KEY=your_groq_api_key_here

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 📋 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GROQ_API_KEY` | ✅ Yes | Your Groq API key |
| `GROQ_MODEL` | No | Model to use (default: llama-3.1-8b-instant) |
| `DATABASE_URL` | No | Database URL (SQLite default for dev) |

---

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── page.tsx          # Main application
│   │   ├── api/
│   │   │   └── llm/route.ts  # Groq API endpoint
│   │   └── layout.tsx
│   ├── components/ui/        # shadcn/ui components
│   └── lib/
├── prisma/
│   └── schema.prisma         # Database schema
├── public/
├── vercel.json               # Vercel configuration
└── package.json
```

---

## ➕ Adding New Document Types

Document types are configured in `src/app/page.tsx` in the `DOCUMENTS` object:

```typescript
const DOCUMENTS: Record<string, DocumentConfig> = {
  will: { /* ... */ },
  power_of_attorney: { /* ... */ },
  // Add new document types here
}
```

---

## License

MIT
