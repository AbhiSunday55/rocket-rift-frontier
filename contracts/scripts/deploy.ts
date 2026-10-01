import { ethers, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Deploys the ROCKET RIFT: FRONTIER contract suite and wires permissions:
 *   1. ShipNFT      (ERC-721, ships)
 *   2. ItemNFT      (ERC-1155, weapons/skins/equipment/collectibles/accessories)
 *   3. Marketplace  (escrow, native + ERC-20, fee in bps)
 *
 * Then allow-lists both asset contracts on the marketplace and grants the
 * deployer minter rights (in production, grant the game server's hot wallet).
 *
 * The result is written to `deployments/<network>.json` so the client and the
 * server can be pointed at it without copy-pasting addresses by hand, and the
 * exact `.env` block is printed at the end.
 *
 * Usage:
 *   npm run deploy:sepolia --workspace contracts
 *   npm run deploy:local   --workspace contracts
 */

export interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  deployedAt: string;
  feeBps: number;
  treasury: string;
  baseURI: string;
  contracts: { shipNft: string; itemNft: string; marketplace: string };
  allowListed: { shipNft: boolean; itemNft: boolean };
  txHashes: Record<string, string>;
}

const FAUCET_HINT =
  '  Sepolia ETH faucets: https://sepoliafaucet.com  |  https://www.alchemy.com/faucets/ethereum-sepolia';

/**
 * Rewrites the CHAIN_ID / *_ADDRESS keys in an existing .env file in place,
 * preserving every other line (comments, secrets, ordering). Used by
 * `WRITE_ENV=1` so the client and server point at a fresh deployment without
 * anyone hand-editing addresses.
 */
function writeEnvFile(file: string, values: Record<string, string>): void {
  const rel = path.relative(process.cwd(), file);
  if (!fs.existsSync(file)) {
    console.log(`  – skipped ${rel} (does not exist)`);
    return;
  }
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const seen = new Set<string>();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && values[m[1]] !== undefined) {
      seen.add(m[1]);
      return `${m[1]}=${values[m[1]]}`;
    }
    return line;
  });
  for (const [k, v] of Object.entries(values)) {
    if (!seen.has(k)) out.push(`${k}=${v}`);
  }
  fs.writeFileSync(file, out.join('\n'), 'utf8');
  console.log(`  ✔ ${rel}`);
}

async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  const deployer = signers[0];

  if (!deployer) {
    throw new Error(
      'No deployer account available.\n' +
        'Set DEPLOYER_PRIVATE_KEY in the repo-root .env to a FUNDED key for the target network, then retry.\n' +
        FAUCET_HINT
    );
  }

  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const balance = await ethers.provider.getBalance(deployer.address);

  const feeBps = Number(process.env.MARKETPLACE_FEE_BPS || 250);
  const baseURI = process.env.NFT_BASE_URI || 'https://cdn.rocketrift.game/metadata/';
  const treasury = process.env.MARKETPLACE_TREASURY || deployer.address;

  console.log('─'.repeat(66));
  console.log('ROCKET RIFT: FRONTIER — contract deployment');
  console.log('─'.repeat(66));
  console.log(`Network      : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer     : ${deployer.address}`);
  console.log(`Balance      : ${ethers.formatEther(balance)} ETH`);
  console.log(`Marketplace  : fee ${feeBps} bps (${(feeBps / 100).toFixed(2)}%), treasury ${treasury}`);
  console.log(`Base URI     : ${baseURI}`);
  console.log('─'.repeat(66));

  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has 0 ETH on ${network.name} — it cannot pay gas.\n` +
        `Fund it, then re-run this command.\n${FAUCET_HINT}`
    );
  }

  const txHashes: Record<string, string> = {};

  const ShipNFT = await ethers.getContractFactory('ShipNFT');
  const ship = await ShipNFT.deploy('Rocket Rift Ship', 'RIFTSHIP', baseURI);
  await ship.waitForDeployment();
  const shipAddr = await ship.getAddress();
  txHashes.shipNft = ship.deploymentTransaction()?.hash ?? '';
  console.log(`ShipNFT      -> ${shipAddr}`);

  const ItemNFT = await ethers.getContractFactory('ItemNFT');
  const item = await ItemNFT.deploy(baseURI);
  await item.waitForDeployment();
  const itemAddr = await item.getAddress();
  txHashes.itemNft = item.deploymentTransaction()?.hash ?? '';
  console.log(`ItemNFT      -> ${itemAddr}`);

  const Marketplace = await ethers.getContractFactory('Marketplace');
  const market = await Marketplace.deploy(feeBps, treasury);
  await market.waitForDeployment();
  const marketAddr = await market.getAddress();
  txHashes.marketplace = market.deploymentTransaction()?.hash ?? '';
  console.log(`Marketplace  -> ${marketAddr}`);

  console.log('Allow-listing asset contracts on the marketplace…');
  const tx1 = await market.setAssetContractAllowed(shipAddr, true);
  await tx1.wait();
  txHashes.allowShipNft = tx1.hash;
  const tx2 = await market.setAssetContractAllowed(itemAddr, true);
  await tx2.wait();
  txHashes.allowItemNft = tx2.hash;

  // Optionally hand minter rights to the game server's hot wallet.
  const gameServer = process.env.GAME_SERVER_ADDRESS;
  if (gameServer) {
    console.log(`Granting minter rights to the game server (${gameServer})…`);
    const t3 = await ship.setMinter(gameServer, true);
    await t3.wait();
    txHashes.shipMinter = t3.hash;
    const t4 = await item.setMinter(gameServer, true);
    await t4.wait();
    txHashes.itemMinter = t4.hash;
  }

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
    feeBps,
    treasury,
    baseURI,
    contracts: { shipNft: shipAddr, itemNft: itemAddr, marketplace: marketAddr },
    allowListed: { shipNft: true, itemNft: true },
    txHashes,
  };

  const outDir = path.join(__dirname, '..', 'deployments');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  // `WRITE_ENV=1` propagates the addresses into the client and server env files.
  // (An env var rather than a CLI flag: Hardhat rejects unknown `--flags`.)
  if (process.env.WRITE_ENV === '1' || process.argv.includes('--write-env')) {
    const root = path.join(__dirname, '..', '..');
    console.log('\nWriting addresses into .env files…');
    const serverVars = {
      CHAIN_ID: String(chainId),
      SHIP_NFT_ADDRESS: shipAddr,
      ITEM_NFT_ADDRESS: itemAddr,
      MARKETPLACE_ADDRESS: marketAddr,
    };
    writeEnvFile(path.join(root, '.env'), serverVars);
    writeEnvFile(path.join(root, 'server', '.env'), serverVars);
    writeEnvFile(path.join(root, 'client', '.env'), {
      VITE_CHAIN_ID: String(chainId),
      VITE_SHIP_NFT_ADDRESS: shipAddr,
      VITE_ITEM_NFT_ADDRESS: itemAddr,
      VITE_MARKETPLACE_ADDRESS: marketAddr,
    });
  }

  console.log('─'.repeat(66));
  console.log(`Deployment record written to contracts/deployments/${network.name}.json`);
  console.log('─'.repeat(66));
  console.log('\n# ── Server (.env) ─────────────────────────────────────────────');
  console.log(`CHAIN_ID=${chainId}`);
  console.log(`SHIP_NFT_ADDRESS=${shipAddr}`);
  console.log(`ITEM_NFT_ADDRESS=${itemAddr}`);
  console.log(`MARKETPLACE_ADDRESS=${marketAddr}`);
  console.log('\n# ── Client (client/.env) ──────────────────────────────────────');
  console.log(`VITE_CHAIN_ID=${chainId}`);
  console.log(`VITE_SHIP_NFT_ADDRESS=${shipAddr}`);
  console.log(`VITE_ITEM_NFT_ADDRESS=${itemAddr}`);
  console.log(`VITE_MARKETPLACE_ADDRESS=${marketAddr}`);
  console.log('\nNext: npm run verify:deployment --workspace contracts');
}

main().catch((err) => {
  console.error('\n✖ Deployment failed:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
