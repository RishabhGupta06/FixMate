# FixMate

FixMate is a safety-first home repair assistant and community tool-rental marketplace.

## Features

- Structured repair plans with steps, tools, materials, and safety warnings
- Gemini API integration with a local fallback
- JWT authentication and bcrypt password hashing
- MongoDB persistence through Mongoose
- Community tool listings and nearby sorting
- Rental requests with owner accept/reject workflow
- Responsive React interface

## Run locally

Start MongoDB, then run the backend:

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Set `MONGODB_URI`, `JWT_SECRET`, and optionally `AI_PROVIDER=gemini`, `GEMINI_API_KEY`, and `GEMINI_MODEL` in `backend/.env`.

Run the frontend in a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Security

Never commit `backend/.env`, API keys, JWT secrets, or database credentials. Use `backend/.env.example` as the configuration template.
