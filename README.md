# LedgerSite

AI bookkeeping tool built for my dad's construction business.

He runs a construction contracting business. Every payment — labor, materials, vendors — was being noted by hand. Slow, repetitive, easy to mess up.

So I built LedgerSite.

## What it does

- Send a payment screenshot on WhatsApp → AI extracts party, amount, date, UTR automatically
- Add a note like "Rakesh labour week 3" and Gemini understands it
- Save, Edit, or Split the entry directly from WhatsApp
- Ledger draft created automatically — no need to open the app
- Export monthly Excel or party ledger from WhatsApp or web
- Full web dashboard for reviewing, confirming, and managing entries

## Tech stack

- Next.js + TypeScript
- Supabase (database + storage + auth)
- Gemini 2.5 Flash Vision API
- Twilio WhatsApp
- Vercel

## Live

ledgersite-rho.vercel.app

## Built by

Shivanshu Yadav — 19, CSE AI/ML, G.Noida
github.com/zendyXD
