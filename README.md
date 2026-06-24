# LedgerSite

LedgerSite is a lightweight bookkeeping web app built for my dad’s construction business. It helps turn payment screenshots into structured ledger data so bookkeeping is faster, cleaner, and less manual.

## What it does

- Upload payment screenshots and transaction proofs.
- Use AI to extract key details like party name, amount, date, and transaction ID.
- Review and edit extracted data before saving.
- Generate Excel-ready ledger journal entries from the proof data.

## Why I built it

I built LedgerSite because I was manually handling bookkeeping for my dad’s construction business, and the process was slow and repetitive. The goal was to create a simple workflow that reduces manual entry, keeps records organized, and saves time on everyday bookkeeping tasks.

## Tech stack

- Next.js
- TypeScript
- Supabase
- Gemini Vision API
- Vercel

## Run locally

### 1. Clone the repository

```bash
git clone https://github.com/ZendyXD/ledgersite.git
cd ledgersite
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create `.env.local`

Add a `.env.local` file in the project root with the following keys:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
```

### 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Deployment

LedgerSite is deployed on Vercel.
