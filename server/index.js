import 'dotenv/config';

// Polyfill for Node 18
if (!global.crypto) {
    const { webcrypto } = await import('node:crypto');
    global.crypto = webcrypto;
}

const { assertOwnerConfiguration, reconcileOwnerAuthority } = await import('./ownerAuthority.js');
assertOwnerConfiguration();

const { runMigrations } = await import('./migrations.js');
await runMigrations();
await reconcileOwnerAuthority();

// Backfills the gallery index for projects published before it existed (and rebuilds it
// after a rule change). Not awaited: the site serves while it runs, and a not-yet-indexed
// project is still listed — it only misses search and the category/format/tag filters until reached.
const { reindexStale } = await import('./galleryIndex.js');
reindexStale().catch(e => console.error('[gallery-index] sweep failed:', e));

const { createApp } = await import('./app.js');
const app = createApp();

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
