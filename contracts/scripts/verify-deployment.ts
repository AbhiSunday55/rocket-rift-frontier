import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Reads a deployment back off-chain and asserts the wiring is correct.
 *
 * This is the "prove it actually works" step: it does not trust the deploy
 * script's own output, it re-queries the chain for the owner, the collection
 * name/symbol, the marketplace fee and treasury, and the asset allow-list.
 *
 * Usage:
 *   npm run verify:deployment --workspace contracts              # uses deployments/<network>.json
 *   npm run verify:deployment --workspace contracts --network sepolia
 *
 * Exits non-zero if any assertion fails, so it is safe to use in CI.
 */

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  feeBps: number;
  treasury: string;
  contracts: { shipNft: string; itemNft: string; marketplace: string };
}

const ZERO = '0x0000000000000000000000000000000000000000';

function loadRecord(): DeploymentRecord {
  const file = path.join(__dirname, '..', 'deployments', `${network.name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `No deployment record at contracts/deployments/${network.name}.json.\n` +
        `Deploy first:  npm run deploy:${network.name} --workspace contracts`
    );
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DeploymentRecord;
}

async function main(): Promise<void> {
  const record = loadRecord();
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);

  const checks: { label: string; ok: boolean; detail: string }[] = [];
  const check = (label: string, ok: boolean, detail: string) => {
    checks.push({ label, ok, detail });
  };

  console.log('─'.repeat(66));
  console.log(`Verifying deployment on ${network.name} (chainId ${chainId})`);
  console.log('─'.repeat(66));

  // ── Chain identity ────────────────────────────────────────────────────────
  check('chain id matches record', chainId === record.chainId, `${chainId} vs recorded ${record.chainId}`);

  // ── Code is actually deployed at each address ─────────────────────────────
  for (const [name, addr] of Object.entries(record.contracts)) {
    const code = await ethers.provider.getCode(addr);
    check(`${name} has bytecode`, code !== '0x' && code.length > 2, `${addr} (${(code.length - 2) / 2} bytes)`);
  }

  // ── ShipNFT ───────────────────────────────────────────────────────────────
  const ship = await ethers.getContractAt('ShipNFT', record.contracts.shipNft);
  const [shipName, shipSymbol, shipOwner, shipTotal, shipBase] = await Promise.all([
    ship.name(),
    ship.symbol(),
    ship.owner(),
    ship.totalMinted(),
    ship.baseTokenURI(),
  ]);
  check('ShipNFT.name()', shipName === 'Rocket Rift Ship', shipName);
  check('ShipNFT.symbol()', shipSymbol === 'RIFTSHIP', shipSymbol);
  check('ShipNFT.owner()', shipOwner.toLowerCase() === record.deployer.toLowerCase(), shipOwner);
  check('ShipNFT.totalMinted()', shipTotal === 0n, `${shipTotal} minted`);
  check('ShipNFT.baseTokenURI()', shipBase.length > 0, shipBase);

  // ── ItemNFT ───────────────────────────────────────────────────────────────
  const item = await ethers.getContractAt('ItemNFT', record.contracts.itemNft);
  const [itemOwner, itemTypes, itemBase] = await Promise.all([item.owner(), item.totalTypes(), item.baseTokenURI()]);
  check('ItemNFT.owner()', itemOwner.toLowerCase() === record.deployer.toLowerCase(), itemOwner);
  check('ItemNFT.totalTypes()', itemTypes === 0n, `${itemTypes} types`);
  check('ItemNFT.baseTokenURI()', itemBase.length > 0, itemBase);

  // ── Marketplace ───────────────────────────────────────────────────────────
  const market = await ethers.getContractAt('Marketplace', record.contracts.marketplace);
  const [feeBps, treasury, marketOwner, nextListingId, shipAllowed, itemAllowed] = await Promise.all([
    market.feeBps(),
    market.treasury(),
    market.owner(),
    market.nextListingId(),
    market.allowedAssetContracts(record.contracts.shipNft),
    market.allowedAssetContracts(record.contracts.itemNft),
  ]);
  check('Marketplace.feeBps()', feeBps === BigInt(record.feeBps), `${feeBps} bps`);
  check('Marketplace.treasury()', treasury.toLowerCase() === record.treasury.toLowerCase(), treasury);
  check('Marketplace.owner()', marketOwner.toLowerCase() === record.deployer.toLowerCase(), marketOwner);
  check('Marketplace.nextListingId()', nextListingId === 1n, `${nextListingId}`);
  check('Marketplace allow-lists ShipNFT', shipAllowed === true, String(shipAllowed));
  check('Marketplace allow-lists ItemNFT', itemAllowed === true, String(itemAllowed));

  // ── Addresses are not the zero address ────────────────────────────────────
  for (const [name, addr] of Object.entries(record.contracts)) {
    check(`${name} is non-zero`, addr !== ZERO, addr);
  }

  // ── Report ────────────────────────────────────────────────────────────────
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`${c.ok ? '✔' : '✖'} ${c.label.padEnd(34)} ${c.detail}`);
  }

  console.log('─'.repeat(66));
  if (failed === 0) {
    console.log(`✔ All ${checks.length} checks passed — deployment is live and correctly wired.`);
    console.log(`  ShipNFT     ${record.contracts.shipNft}`);
    console.log(`  ItemNFT     ${record.contracts.itemNft}`);
    console.log(`  Marketplace ${record.contracts.marketplace}`);
  } else {
    console.log(`✖ ${failed} of ${checks.length} checks FAILED.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('\n✖ Verification failed:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
