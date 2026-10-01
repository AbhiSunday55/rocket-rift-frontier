import { Wallet } from 'ethers';
import { createHmac } from 'node:crypto';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:4000';
const SECRET = 'dev-only-session-hmac-secret-change-me';
const DB = 'postgres://postgres:postgres@localhost:5432/rocket_rift';

const j = async (path, init = {}) => {
  const res = await fetch(BASE + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

const ok = (label, cond, extra = '') =>
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);

const sql = (q) =>
  execSync(`psql "${DB}" -tAc ${JSON.stringify(q.replace(/\s+/g, ' ').trim())}`, {
    env: { ...process.env, PGPASSWORD: 'postgres' },
  }).toString().trim();

const wallet = Wallet.createRandom();
const address = wallet.address;

// 1. nonce
const nonceRes = await j(`/api/auth/nonce?address=${address}`);
ok('GET /api/auth/nonce', nonceRes.status === 200 && !!nonceRes.body.nonce);

// 2. sign + verify
const signature = await wallet.signMessage(nonceRes.body.message);
const verifyRes = await j('/api/auth/verify', {
  method: 'POST',
  body: JSON.stringify({ address, signature, nonce: nonceRes.body.nonce }),
});
ok('POST /api/auth/verify (wallet sig)', verifyRes.status === 200 && !!verifyRes.body.token,
   verifyRes.body.error ?? '');
const token = verifyRes.body.token;
const auth = { Authorization: `Bearer ${token}` };

// 3. profile (players + ships + inventory)
const me = await j('/api/players/me', { headers: auth });
ok('GET /api/players/me', me.status === 200 && me.body.profile?.id && me.body.ships?.length === 1,
   me.body.error ?? `ships=${me.body.ships?.length}`);
ok('  starter hull is raptor_x', me.body.ships?.[0]?.shipKey === 'raptor_x');
ok('  profile has aggregate stats', typeof me.body.profile?.stats?.runsPlayed === 'number');
const playerId = me.body.profile.id;

// 4. leaderboard
const lb = await j('/api/players/leaderboard?season=1', { headers: auth });
ok('GET /api/players/leaderboard', lb.status === 200 && Array.isArray(lb.body.rows));

// 5. missions (ensureMissions upsert)
const missions = await j('/api/missions', { headers: auth });
ok('GET /api/missions (upsert)', missions.status === 200 && missions.body.missions?.length > 0,
   missions.body.error ?? `count=${missions.body.missions?.length}`);

// 6. run start
const start = await j('/api/runs/start', { method: 'POST', headers: auth });
ok('POST /api/runs/start', start.status === 200 && !!start.body.sessionId, start.body.error ?? '');
const { sessionId, seed } = start.body;

// 7. sign the run exactly as the server canonicalises it
const claim = {
  sessionId, seed, sectorReached: 5, score: 10000, kills: 20,
  damageDealt: 5000, damageTaken: 100, lootValue: 200,
  xpGained: 300, scrapGained: 100, plasmaGained: 0,
  durationMs: 120000, bossKilled: true,
};
const canonical = [
  claim.sessionId, claim.seed, claim.sectorReached, claim.score, claim.kills,
  claim.damageDealt, claim.damageTaken, claim.lootValue, claim.xpGained,
  claim.scrapGained, claim.plasmaGained, claim.durationMs, claim.bossKilled ? 1 : 0,
].join('|');
const key = createHmac('sha256', SECRET).update(`session:${sessionId}`).digest('hex');
const sig = createHmac('sha256', key).update(canonical).digest('hex');

const submit = await j('/api/runs/submit', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ ...claim, signature: sig, payload: canonical }),
});
ok('POST /api/runs/submit (verified run)', submit.status === 200 && submit.body.verified === true,
   submit.body.error ?? submit.body.reason ?? '');
ok('  rewards paid', (submit.body.rewards?.xp ?? 0) > 0, JSON.stringify(submit.body.rewards));

// 8. a tampered run must be rejected
const start2 = await j('/api/runs/start', { method: 'POST', headers: auth });
const bad = { ...claim, sessionId: start2.body.sessionId, seed: start2.body.seed, score: 999999999 };
const badCanonical = [
  bad.sessionId, bad.seed, bad.sectorReached, bad.score, bad.kills,
  bad.damageDealt, bad.damageTaken, bad.lootValue, bad.xpGained,
  bad.scrapGained, bad.plasmaGained, bad.durationMs, bad.bossKilled ? 1 : 0,
].join('|');
const badKey = createHmac('sha256', SECRET).update(`session:${bad.sessionId}`).digest('hex');
const badSig = createHmac('sha256', badKey).update(badCanonical).digest('hex');
const rejected = await j('/api/runs/submit', {
  method: 'POST', headers: auth,
  body: JSON.stringify({ ...bad, signature: badSig, payload: badCanonical }),
});
ok('  tampered run is flagged, not rewarded',
   rejected.body.flagged === true && rejected.body.verified === false,
   rejected.body.reason ?? '');

// 9. missions advanced by the run
const missions2 = await j('/api/missions', { headers: auth });
const advanced = missions2.body.missions?.some((m) => m.progress > 0);
ok('  run advanced mission progress', advanced);

// 10. claim a completed mission
const completed = missions2.body.missions?.find((m) => m.completed && !m.claimed);
if (completed) {
  const claimRes = await j(`/api/missions/${completed.missionKey}/claim`, { method: 'POST', headers: auth });
  ok('POST /api/missions/:key/claim', claimRes.status === 200, claimRes.body.error ?? '');
} else {
  console.log('SKIP  mission claim (none completed yet)');
}

// 11. marketplace browse
const listings = await j('/api/marketplace/listings');
ok('GET /api/marketplace/listings', listings.status === 200 && listings.body.listings?.length > 0,
   `count=${listings.body.listings?.length}`);

// 12. list an item (escrow) — grant one first so a fresh pilot has something to sell
sql(`INSERT INTO inventory_items (player_id, item_key, name, category, rarity, state, quantity, level, stats, acquired_via, acquired_at)
     VALUES ('${playerId}','test_blade','Test Blade','WEAPON',2,'TRADEABLE',1,1,'{}'::jsonb,'LOOT', now())`);
const inv = await j('/api/inventory', { headers: auth });
const item = inv.body.items?.[0];
ok('GET /api/inventory', inv.status === 200 && !!item, `count=${inv.body.items?.length}`);

if (item) {
  const created = await j('/api/marketplace/listings', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ assetKind: 'ITEM', assetId: item.id, priceEth: '0.25' }),
  });
  ok('POST /api/marketplace/listings (escrow)', created.status === 201, created.body.error ?? '');
  if (created.status === 201) {
    const escrowed = sql(`SELECT state FROM inventory_items WHERE id = '${item.id}'`);
    ok('  item is escrowed as LISTED', escrowed === 'LISTED', `state=${escrowed}`);
    const cancel = await j(`/api/marketplace/listings/${created.body.listing.id}`, { method: 'DELETE', headers: auth });
    ok('DELETE /api/marketplace/listings/:id (release)', cancel.status === 200, cancel.body.error ?? '');
    const released = sql(`SELECT state FROM inventory_items WHERE id = '${item.id}'`);
    ok('  escrow released to TRADEABLE', released === 'TRADEABLE', `state=${released}`);
  }
}

// 13. trades
const trades = await j('/api/trades', { headers: auth });
ok('GET /api/trades', trades.status === 200 && Array.isArray(trades.body.trades), trades.body.error ?? '');

// 14. health
const health = await j('/api/health');
ok('GET /api/health', health.status === 200 && health.body.database === 'up');

console.log('\nE2E COMPLETE');
