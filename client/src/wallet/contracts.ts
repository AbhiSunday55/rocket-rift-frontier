import { BrowserProvider, Contract, formatEther, parseEther, type Signer } from 'ethers';
import type { Eip1193Provider } from './types';

/**
 * On-chain integration.
 *
 * Read paths work with any RPC; write paths require a connected signer. Every
 * write is a *player-initiated* transaction — the game never signs on the
 * player's behalf and never holds their key.
 */

export const CHAIN_ID = Number(import.meta.env.VITE_CHAIN_ID ?? 11155111);

export const ADDRESSES = {
  shipNft: (import.meta.env.VITE_SHIP_NFT_ADDRESS as string) ?? '0x0000000000000000000000000000000000000000',
  itemNft: (import.meta.env.VITE_ITEM_NFT_ADDRESS as string) ?? '0x0000000000000000000000000000000000000000',
  marketplace: (import.meta.env.VITE_MARKETPLACE_ADDRESS as string) ?? '0x0000000000000000000000000000000000000000',
};

/** Minimal ABIs — only the surface the client actually calls. */
export const SHIP_NFT_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function totalMinted() view returns (uint256)',
  'function getShip(uint256 tokenId) view returns (tuple(string shipKey, uint8 rarity, uint16 level, tuple(uint16 health, uint16 shield, uint16 damage, uint16 speed, uint16 fireRate, uint16 critChance, uint16 cargo) stats, bool locked))',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
  'function mintWithVoucher(address to, string shipKey, uint8 rarity, uint16 level, tuple(uint16 health, uint16 shield, uint16 damage, uint16 speed, uint16 fireRate, uint16 critChance, uint16 cargo) stats, string uri, uint256 nonce, uint256 deadline, bytes signature)',
  'event ShipMinted(uint256 indexed tokenId, address indexed to, string shipKey, uint8 rarity)',
];

export const ITEM_NFT_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
  'function getItemType(uint256 typeId) view returns (tuple(string itemKey, uint8 category, uint8 rarity, uint16 maxSupply, bool soulbound, bool tradeable))',
  'function totalTypes() view returns (uint256)',
  'function uri(uint256 typeId) view returns (string)',
  'function isApprovedForAll(address account, address operator) view returns (bool)',
  'function setApprovalForAll(address operator, bool approved)',
];

export const MARKETPLACE_ABI = [
  'function feeBps() view returns (uint256)',
  'function treasury() view returns (address)',
  'function nextListingId() view returns (uint256)',
  'function getListing(uint256 listingId) view returns (tuple(address seller, address assetContract, uint8 kind, uint256 tokenId, uint256 amount, address paymentToken, uint256 price, uint256 expiry, bool active))',
  'function isActive(uint256 listingId) view returns (bool)',
  'function quote(uint256 listingId) view returns (uint256 fee, uint256 sellerProceeds)',
  'function listERC721(address assetContract, uint256 tokenId, address paymentToken, uint256 price, uint256 expiry) returns (uint256)',
  'function listERC1155(address assetContract, uint256 tokenId, uint256 amount, address paymentToken, uint256 price, uint256 expiry) returns (uint256)',
  'function buy(uint256 listingId) payable',
  'function cancel(uint256 listingId)',
  'function updatePrice(uint256 listingId, uint256 newPrice)',
  'event Listed(uint256 indexed listingId, address indexed seller, address assetContract, uint256 tokenId, uint256 amount, address paymentToken, uint256 price, uint256 expiry)',
  'event Purchased(uint256 indexed listingId, address indexed buyer, address indexed seller, uint256 price, uint256 fee, address paymentToken)',
];

/** Builds an ethers signer from an EIP-1193 provider. */
export async function getSigner(provider: Eip1193Provider): Promise<Signer> {
  const browserProvider = new BrowserProvider(provider as never);
  return browserProvider.getSigner();
}

export async function getMarketplaceContract(provider: Eip1193Provider, withSigner = false): Promise<Contract> {
  const browserProvider = new BrowserProvider(provider as never);
  const runner = withSigner ? await browserProvider.getSigner() : browserProvider;
  return new Contract(ADDRESSES.marketplace, MARKETPLACE_ABI, runner);
}

export async function getShipContract(provider: Eip1193Provider, withSigner = false): Promise<Contract> {
  const browserProvider = new BrowserProvider(provider as never);
  const runner = withSigner ? await browserProvider.getSigner() : browserProvider;
  return new Contract(ADDRESSES.shipNft, SHIP_NFT_ABI, runner);
}

export async function getItemContract(provider: Eip1193Provider, withSigner = false): Promise<Contract> {
  const browserProvider = new BrowserProvider(provider as never);
  const runner = withSigner ? await browserProvider.getSigner() : browserProvider;
  return new Contract(ADDRESSES.itemNft, ITEM_NFT_ABI, runner);
}

/**
 * A transaction preview shown to the player BEFORE they sign anything.
 * This is the "no surprises" rule: the player always sees what will happen.
 */
export interface TxPreview {
  action: string;
  assetName: string;
  priceEth: string;
  feeEth: string;
  sellerReceivesEth: string;
  paymentToken: string;
  contract: string;
  /** Plain-language summary of the state change. */
  summary: string;
  warnings: string[];
}

export function buildBuyPreview(opts: {
  assetName: string;
  priceWei: bigint;
  feeBps: number;
  paymentToken?: string;
}): TxPreview {
  const fee = (opts.priceWei * BigInt(opts.feeBps)) / 10000n;
  const proceeds = opts.priceWei - fee;
  const isNative = !opts.paymentToken || opts.paymentToken === '0x0000000000000000000000000000000000000000';

  const warnings: string[] = [];
  if (!isNative) warnings.push('Payment is in an ERC-20 token — make sure you have enough and have approved the marketplace.');
  warnings.push('Blockchain transactions are irreversible. Verify the price and asset before confirming.');

  return {
    action: 'BUY',
    assetName: opts.assetName,
    priceEth: formatEther(opts.priceWei),
    feeEth: formatEther(fee),
    sellerReceivesEth: formatEther(proceeds),
    paymentToken: isNative ? 'Native (ETH/MATIC)' : opts.paymentToken!,
    contract: ADDRESSES.marketplace,
    summary: `You will pay ${formatEther(opts.priceWei)} to the marketplace escrow. The seller receives ${formatEther(proceeds)} and the protocol takes ${formatEther(fee)} (${(opts.feeBps / 100).toFixed(2)}%). The asset transfers to your wallet immediately.`,
    warnings,
  };
}

export function buildListPreview(opts: {
  assetName: string;
  priceEth: string;
  feeBps: number;
}): TxPreview {
  const priceWei = parseEther(opts.priceEth || '0');
  const fee = (priceWei * BigInt(opts.feeBps)) / 10000n;

  return {
    action: 'LIST',
    assetName: opts.assetName,
    priceEth: opts.priceEth,
    feeEth: formatEther(fee),
    sellerReceivesEth: formatEther(priceWei - fee),
    paymentToken: 'Native (ETH/MATIC)',
    contract: ADDRESSES.marketplace,
    summary: `Your asset moves into marketplace escrow. It stays yours until someone buys it — you can cancel at any time and reclaim it. If it sells, you receive ${formatEther(priceWei - fee)} after the ${(opts.feeBps / 100).toFixed(2)}% protocol fee.`,
    warnings: ['While listed, the asset is held in escrow and cannot be used in-game.'],
  };
}

export function buildTradePreview(opts: {
  giving: string[];
  receiving: string[];
  givingPlasma: number;
  receivingPlasma: number;
}): TxPreview {
  return {
    action: 'TRADE',
    assetName: `${opts.giving.length} item(s) ⇄ ${opts.receiving.length} item(s)`,
    priceEth: '0',
    feeEth: '0',
    sellerReceivesEth: '0',
    paymentToken: 'None',
    contract: 'P2P (server-coordinated)',
    summary: `You give: ${opts.giving.join(', ') || 'nothing'}${opts.givingPlasma ? ` + ${opts.givingPlasma} Plasma` : ''}. You receive: ${opts.receiving.join(', ') || 'nothing'}${opts.receivingPlasma ? ` + ${opts.receivingPlasma} Plasma` : ''}. Both parties must confirm before anything moves.`,
    warnings: [
      'P2P trades are final once both parties confirm.',
      'Never trade outside the in-game flow — off-platform trades have no protection.',
    ],
  };
}

export function isContractsConfigured(): boolean {
  return (
    ADDRESSES.marketplace !== '0x0000000000000000000000000000000000000000' &&
    ADDRESSES.shipNft !== '0x0000000000000000000000000000000000000000'
  );
}
