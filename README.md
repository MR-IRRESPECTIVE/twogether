# Twogether — Production Deployment

This repository is configured for a split deployment:
- **Frontend**: Vercel (static site)
- **Backend**: Render (Node.js Web Service)
- **Database**: None (in-memory only)
- **Storage**: Cloudflare R2 / AWS S3 (for temporary images)

## Architecture

Twogether is an ephemeral photobooth. All photos and strips are stored temporarily in S3 and all metadata is stored temporarily in-memory on the Node.js server. When a room expires (after 6 hours of inactivity), all related S3 objects are automatically deleted and memory is freed.

**No permanent user accounts or photo galleries are retained.**

---

## 1. Vercel Configuration (Frontend)

1. Connect your GitHub repository to Vercel.
2. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `client`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
3. Environment Variables:
   - `VITE_SERVER_URL`: The URL of your Render backend (e.g., `https://twogether-api.onrender.com`)
   - `VITE_TURN_URL` (optional): A TURN server URL for WebRTC (e.g., `turn:global.turn.twilio.com:3478?transport=udp`)

*Note: Because the Vercel root is `client`, the build script automatically resolves the `@shared` alias to the parent `shared` directory. Vite handles this perfectly.*

---

## 2. Render Configuration (Backend)

1. Create a new **Web Service** on Render connected to the repository.
2. Configure the service:
   - **Environment**: Node
   - **Root Directory**: `server`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Environment Variables:
   - `PORT`: `3001` (or let Render set it)
   - `FRONTEND_ORIGIN`: Your Vercel domain (e.g., `https://twogether.vercel.app`). You can use a comma-separated list for multiple domains.
   - `OBJECT_STORAGE_ENDPOINT`: e.g., `https://<account-id>.r2.cloudflarestorage.com`
   - `OBJECT_STORAGE_BUCKET`: The name of your R2 bucket
   - `OBJECT_STORAGE_ACCESS_KEY`: Your R2 access key
   - `OBJECT_STORAGE_SECRET_KEY`: Your R2 secret key
   - `OBJECT_STORAGE_REGION`: `auto` (for R2)
   - `ROOM_TTL_MINUTES`: `360` (default 6 hours)
   - `IMAGE_TTL_MINUTES`: `120` (default 2 hours)

---

## 3. Storage Configuration (Cloudflare R2)

1. Create a private bucket in Cloudflare R2.
2. Generate an API token with `Object Read & Write` permissions for that bucket.
3. **Important Safety Net**: Configure an Object Lifecycle Rule on the bucket to automatically delete objects older than 1 day. This guarantees that if the Node.js server crashes before a cleanup cycle, user photos are still safely wiped from storage.

---

## Local Development

You can run both client and server locally using the root scripts:

```bash
# Install dependencies for both
npm run install:all

# In one terminal, start the server
npm run dev:server

# In a second terminal, start the client
npm run dev:client
```

To test storage locally, create a `.env` in the `server` directory using `server/.env.example` as a template.
