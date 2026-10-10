import { readdir, readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardStore } from './store.mjs';

export const name = 'dsh-board';
export const inject = ['connection', 'tools', 'systemPrompt'];
const jsonSafe = value => JSON.parse(JSON.stringify(value));
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
const output = { schema: { type: 'object', additionalProperties: true },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] };

export async function apply(ctx, config = {}) {
  const home = process.env.DSH_HOME;
  if (!config.dataDir && !home) throw new Error('dsh-board requires DSH_HOME or dataDir');
  const store = new BoardStore(config.dataDir ?? join(home, 'dsh-board'));
  await store.ready;
  const register = route => ctx.effect(() => ctx.connection.fetch.register(route));
  register({ path: '/api/dsh-board/state', methods: ['GET'], requestBody: 'buffered',
    fetch: async request => json(await store.snapshot(new URL(request.url).searchParams.get('revision'))) });
  register({ path: '/api/dsh-board/sync', methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      try { return json(await store.sync(await request.json(), request.signal)); }
      catch (error) { return json({ error: { code: error.code ?? 'E_SCHEMA', message: error.message } }, error.code === 'E_SYNC_CONFLICT' ? 409 : 400); }
    } });

  const directory = join(dirname(fileURLToPath(import.meta.url)), '../lib/board-ui');
  const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8' };
  async function mountFiles(relative = '') {
    for (const item of await readdir(join(directory, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${item.name}` : item.name;
      if (item.isDirectory()) await mountFiles(path);
      else if (item.isFile()) {
        const bytes = await readFile(join(directory, path));
        register({ path: '/api/dsh-board/ui/' + path, methods: ['GET', 'HEAD'], requestBody: 'buffered',
          fetch: async request => new Response(request.method === 'HEAD' ? null : bytes, {
            headers: { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' },
          }) });
      }
    }
  }
  await mountFiles();
  ctx.tools.register({ name: 'draft_board_read',
    description: 'Read the current shared whiteboard before maintaining it. Returns card identities, content, relations and contentVersion. User message card links identify objects, not supplied card contents.',
    parameters: { type: 'object', properties: {}, additionalProperties: false }, output,
    isConcurrencySafe: () => true,
    execute: async () => jsonSafe(await store.read()) });
  ctx.tools.register({ name: 'draft_board_apply',
    description: 'Actively maintain the current shared whiteboard with one validated, undoable Draft Board batch. Read first, then send batchVersion=1.0, boardId, baseContentVersion, actor=agent, label and ops. Identity/version conflicts require reading again.',
    parameters: { type: 'object', properties: { batch: { type: 'string', description: 'JSON-encoded AgentBatch. Existing Draft Board operations only.' } }, required: ['batch'], additionalProperties: false }, output,
    execute: async (args, exec) => jsonSafe(await store.apply(JSON.parse(args.batch), exec.signal)) });
  ctx.systemPrompt.section({ name: 'dsh-board', order: ctx.systemPrompt.getSectionOrder('TOOL_READ') + 0.1,
    text: 'You share a persistent editable whiteboard with the user. When useful for learning, product analysis, or project work, proactively maintain it with draft_board_read and draft_board_apply, alongside your explanation. Read before edits, preserve useful existing cards, and group related operations in one undoable batch. Card links in user messages are object references; read their content when needed. New chat sessions continue using the current board until the user changes it. Do not use shell or file-edit tools to bypass the whiteboard batch/version rules.' });
}
