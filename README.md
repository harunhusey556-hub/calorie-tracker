# Calorie Tracker

A mobile-first calorie tracker that understands meals in plain language and from photos.

Type "2 eggs, a slice of rye bread and coffee with milk", or take a picture of your plate, and the app estimates calories and macros with an AI vision/language model. All entries are stored locally on the device, so it also works offline.

## Features

- **Natural-language logging**: write what you ate, the AI turns it into items with calories
- **Photo logging**: snap a meal photo and get an estimate
- **Daily calorie ring** and history view
- **Offline-first PWA**: installable on a phone, data stays on the device (IndexedDB)
- **Finnish-friendly input**: handles comma decimals such as `0,5 l`
- **Resilient AI calls**: primary model with automatic fallback and timeouts

## Tech stack

Next.js 14 · React · TypeScript · Tailwind CSS · Dexie (IndexedDB) · Framer Motion · NVIDIA NIM models

## Quality

- Unit and API tests with **Vitest** and Testing Library
- End-to-end tests with **Playwright**, including offline mode
- Input validation and value clamping on the API routes

## Run locally

```bash
npm install
echo "NVIDIA_API_KEY=your-key" > .env.local
npm run dev
```

```bash
npm test          # unit + API tests
npm run test:e2e  # end-to-end tests
```

## Environment variables

| Variable | Purpose |
|---|---|
| `NVIDIA_API_KEY` | API key for NVIDIA NIM |
| `NVIDIA_MODEL_TEXT` / `NVIDIA_MODEL_TEXT_FALLBACK` | Optional model overrides |
