// Publishes the rendered single-page templates (gallery-templates/out/<slug>.json, written by
// render.mjs) to the gallery as one listing each, owned by the account with --owner-email.
//
// It writes through the server's own functions and repeats what the API routes do — validate the
// state, check the owner's allowances, create the project and its commit, publish it, store the
// previews and reindex the gallery — so a listing made here is indistinguishable from one made in
// the app. A manifest records each slug's project id; running again commits the new state to the
// same project and republishes instead of creating a duplicate.
//
// Local (SQLite):   env -u DATABASE_URL SQLITE_PATH=<db> node scripts/gallery-templates/publish.mjs --owner-email <email>
// Production:       node --env-file=<.env with DATABASE_URL> scripts/gallery-templates/publish.mjs --production --owner-email <email>
//
// Without --production it refuses to run against Postgres; with it, it refuses anything else.
import fs from 'node:fs';
import path from 'node:path';

const arg = name => {
    const i = process.argv.indexOf(name);
    return i > 0 ? process.argv[i + 1] : undefined;
};
const production = process.argv.includes('--production');
const ownerEmail = arg('--owner-email');
if (!ownerEmail) throw new Error('--owner-email is required');
if (production && !process.env.DATABASE_URL) throw new Error('--production needs DATABASE_URL');
if (!production && process.env.DATABASE_URL) throw new Error('DATABASE_URL is set: pass --production to publish to it');

const { dbType, query, withTransaction } = await import('../../server/db.js');
const { validateAppState } = await import('../../server/validateAppState.js');
const { encodeState } = await import('../../server/stateCodec.js');
const { insertCommit, parsePreviewSet, parseTagList, replaceThumbnails } = await import('../../server/routes/projects.js');
const { reindexProject } = await import('../../server/galleryIndex.js');
const { assertProjectAllowance, assertPublishAllowance, assertStorageAllowance } = await import('../../server/middleware/limits.js');

const outDir = path.resolve('gallery-templates/out');
const manifestPath = production
    ? path.resolve('gallery-templates/manifest.production.json')
    : path.join(outDir, 'manifest.local.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const lock = dbType === 'postgres' ? ' FOR UPDATE' : '';

const [user] = await query(
    'SELECT id, email, username, role FROM "user" WHERE lower(email) = lower($1)', [ownerEmail]);
if (!user) throw new Error(`no account with email ${ownerEmail}`);
if (!user.username) throw new Error('the owner account has no username; set one in the app first');
console.log(`${production ? 'PRODUCTION' : 'local'} (${dbType}) · publishing as ${user.username}`);

const files = fs.readdirSync(outDir).filter(f => /^\d\d-.*\.json$/.test(f)).sort();
if (files.length === 0) throw new Error('nothing to publish: run render.mjs first');

for (const file of files) {
    const { slug, listing, state, previews } = JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
    const valid = validateAppState(state);
    if (!valid.ok) throw new Error(`${slug}: invalid state: ${valid.error}`);
    const tags = parseTagList(listing.tags);
    if (!tags) throw new Error(`${slug}: invalid tags`);
    const previewSet = parsePreviewSet({
        thumbnails: previews.map(p => p.dataUrl),
        previewNodeIds: previews.map(p => p.nodeId),
    });
    if (previewSet.error) throw new Error(`${slug}: ${previewSet.error}`);
    const description = listing.description.slice(0, 2000);
    const encoded = encodeState(state);

    const result = await withTransaction(async txQuery => {
        // Same lock order as the publish route: owner row, then project row.
        await txQuery(`SELECT id FROM "user" WHERE id = $1${lock}`, [user.id]);
        let project = manifest[slug]
            ? (await txQuery(`SELECT * FROM projects WHERE id = $1${lock}`, [manifest[slug]]))[0]
            : undefined;
        if (project && project.owner_id !== user.id) throw new Error(`${slug}: manifest project belongs to someone else`);

        let action;
        if (!project) {
            await assertProjectAllowance(user, txQuery);
            await assertStorageAllowance(user, encoded.bytes, txQuery);
            const id = crypto.randomUUID();
            await txQuery('INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, $3)', [id, user.id, listing.name]);
            await insertCommit({ projectId: id, parentCommitId: null, message: 'Initial save', state, userId: user.id, encoded }, txQuery);
            action = 'created';
            project = (await txQuery(`SELECT * FROM projects WHERE id = $1${lock}`, [id]))[0];
        } else {
            const [head] = await txQuery('SELECT state_hash FROM commits WHERE id = $1', [project.head_commit_id]);
            const stored = await txQuery('SELECT image FROM thumbnails WHERE project_id = $1 ORDER BY position', [project.id]);
            const unchanged = head?.state_hash === encoded.hash
                && project.visibility === 'public' && project.published_commit_id === project.head_commit_id
                && project.published_name === listing.name && project.published_description === description
                && project.published_tags === tags
                && stored.length === previewSet.previews.length
                && stored.every((row, i) => Buffer.from(row.image).equals(previewSet.previews[i].buf));
            // Republishing moves the listing up "recently updated"; leave an identical one alone.
            if (unchanged) return { id: project.id, action: 'unchanged' };
            if (head?.state_hash !== encoded.hash) {
                await assertStorageAllowance(user, encoded.bytes, txQuery);
                await insertCommit({ projectId: project.id, parentCommitId: project.head_commit_id, message: 'Update template',
                    state, userId: user.id, encoded }, txQuery);
                action = 'updated';
            } else {
                action = 'republished';
            }
            await txQuery('UPDATE projects SET name = $1 WHERE id = $2', [listing.name, project.id]);
            project = (await txQuery(`SELECT * FROM projects WHERE id = $1${lock}`, [project.id]))[0];
        }

        if (project.visibility !== 'public') await assertPublishAllowance(user, txQuery);
        const updated = await txQuery(
            `UPDATE projects SET visibility = 'public', published_commit_id = $1,
                 published_name = name, published_description = $2, published_tags = $3,
                 published_at = CURRENT_TIMESTAMP, description = $4, tags = $5,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $6 AND head_commit_id = $7
             RETURNING id`,
            [project.head_commit_id, description, tags, description, tags, project.id, project.head_commit_id]);
        if (!updated[0]) throw new Error(`${slug}: project head moved while publishing`);
        await txQuery(
            `INSERT INTO project_publications (project_id, commit_id)
             VALUES ($1, $2) ON CONFLICT (project_id, commit_id) DO NOTHING`,
            [project.id, project.head_commit_id]);
        await replaceThumbnails(project.id, previewSet.previews, txQuery);
        await reindexProject(project.id, txQuery);
        return { id: project.id, action };
    });

    manifest[slug] = result.id;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`${slug}: ${result.action} ${result.id}`);
}
process.exit(0);
