import React, { useEffect, useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { useWallet } from '../wallet/WalletProvider';
import { RARITY, Rarity } from '../game/config/rarity';
import { buildBuyPreview, buildListPreview, isContractsConfigured } from '../wallet/contracts';
import { Bar, EmptyState, Modal, Notice, Panel, RarityTag, StatRow, formatEth, timeAgo } from './ui';
import type { Listing } from '../api/client';

/**
 * Marketplace — browse, buy, and list.
 *
 * Every purchase shows a full transaction preview BEFORE anything is signed:
 * price, protocol fee, what the seller receives, and what changes. The player is
 * never asked to approve a transaction they have not seen.
 */

const CATEGORIES = ['ALL', 'SHIP', 'WEAPON', 'SKIN', 'EQUIPMENT', 'COLLECTIBLE', 'ACCESSORY'];
const SORTS = [
  { key: 'NEWEST', label: 'Newest' },
  { key: 'PRICE_ASC', label: 'Price ↑' },
  { key: 'PRICE_DESC', label: 'Price ↓' },
  { key: 'RARITY', label: 'Rarity' },
] as const;

const FEE_BPS = 250; // 2.5% — mirrors MARKETPLACE_FEE_BPS in .env.example

export function Marketplace() {
  const { listings, refreshListings, buyListing, createListing, cancelListing, profile, apiOnline, pushToast } = useGame();
  const wallet = useWallet();

  const [category, setCategory] = useState('ALL');
  const [rarity, setRarity] = useState(-1);
  const [sort, setSort] = useState<(typeof SORTS)[number]['key']>('NEWEST');
  const [query, setQuery] = useState('');
  const [buyTarget, setBuyTarget] = useState<Listing | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refreshListings({ category, rarity, sort, q: query });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, rarity, sort, apiOnline]);

  const filtered = useMemo(() => {
    let rows = listings;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((l) => l.assetName.toLowerCase().includes(q) || l.sellerName.toLowerCase().includes(q));
    }
    return rows;
  }, [listings, query]);

  const myListings = listings.filter((l) => l.sellerId === profile.id);

  const handleBuy = async (listing: Listing) => {
    setBusy(true);
    try {
      const res = await buyListing(listing.id);
      if (!res.ok) {
        pushToast(res.reason ?? 'Purchase failed', 'danger');
      } else {
        setBuyTarget(null);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel
        title="MARKETPLACE"
        actions={
          <div className="btn-row">
            <span className="mono-dim">{filtered.length} active listing(s)</span>
            <button className="btn btn-primary btn-sm" onClick={() => setListOpen(true)}>
              + LIST AN ASSET
            </button>
          </div>
        }
      >
        {!apiOnline ? (
          <Notice tone="warn">
            The game server is unreachable, so these are <b>demo listings</b> to show how the marketplace works. Nothing
            here can be bought for real value.
          </Notice>
        ) : (
          <Notice>
            Trades settle on-chain when contracts are deployed, and in the game database otherwise. Either way, the
            protocol fee is {(FEE_BPS / 100).toFixed(2)}% and is shown before you confirm.
          </Notice>
        )}

        <div className="filters">
          {CATEGORIES.map((c) => (
            <button key={c} className={`filter-chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        <div className="filters">
          <button className={`filter-chip ${rarity === -1 ? 'active' : ''}`} onClick={() => setRarity(-1)}>
            ANY RARITY
          </button>
          {[Rarity.COMMON, Rarity.UNCOMMON, Rarity.RARE, Rarity.EPIC, Rarity.LEGENDARY, Rarity.MYTHIC].map((r) => (
            <button
              key={r}
              className={`filter-chip ${rarity === r ? 'active' : ''}`}
              style={rarity === r ? undefined : { color: RARITY[r].css }}
              onClick={() => setRarity(r)}
            >
              {RARITY[r].name}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <input
            placeholder="Search assets or pilots…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ minWidth: 180 }}
            aria-label="Search listings"
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as (typeof SORTS)[number]['key'])} aria-label="Sort listings">
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon="🏷" title="NO LISTINGS" hint="Nothing matches those filters. Try widening them." />
        ) : (
          <div className="grid grid-3">
            {filtered.map((listing) => {
              const meta = RARITY[listing.rarity as Rarity] ?? RARITY[Rarity.COMMON];
              const mine = listing.sellerId === profile.id;
              return (
                <div key={listing.id} className="card listing-card">
                  <div className="listing-thumb" aria-hidden>
                    {listing.assetKind === 'SHIP' ? '🚀' : listing.category === 'WEAPON' ? '🔫' : listing.category === 'SKIN' ? '🎨' : '📦'}
                  </div>
                  <div className="flex-between">
                    <h3 className="card-name" style={{ color: meta.css }}>
                      {listing.assetName}
                    </h3>
                    <RarityTag rarity={listing.rarity as Rarity} />
                  </div>
                  <p className="card-sub">
                    {listing.category} · sold by {listing.sellerName}
                    {listing.demo ? ' · DEMO' : ''}
                  </p>
                  <div className="flex-between">
                    <span className="listing-price">
                      {listing.priceEth} <small>ETH</small>
                    </span>
                    <span className="mono-dim">{timeAgo(listing.createdAt)}</span>
                  </div>
                  <div className="btn-row">
                    {mine ? (
                      <button className="btn btn-sm btn-danger" onClick={() => cancelListing(listing.id)}>
                        CANCEL
                      </button>
                    ) : (
                      <button className="btn btn-sm btn-primary" onClick={() => setBuyTarget(listing)}>
                        BUY
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {myListings.length > 0 ? (
        <Panel title="YOUR LISTINGS" actions={<span className="mono-dim">{myListings.length} active</span>}>
          <div className="grid grid-3">
            {myListings.map((l) => (
              <div key={l.id} className="card">
                <h3 className="card-name">{l.assetName}</h3>
                <StatRow label="Price" value={`${l.priceEth} ETH`} />
                <StatRow label="Status" value={l.status} />
                <div style={{ marginTop: 10 }}>
                  <button className="btn btn-sm btn-danger" onClick={() => cancelListing(l.id)}>
                    CANCEL LISTING
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      {buyTarget ? (
        <BuyConfirm
          listing={buyTarget}
          busy={busy}
          onClose={() => setBuyTarget(null)}
          onConfirm={() => handleBuy(buyTarget)}
        />
      ) : null}

      {listOpen ? (
        <ListAsset
          onClose={() => setListOpen(false)}
          onSubmit={async (body) => {
            const res = await createListing(body);
            if (!res.ok) pushToast(res.reason ?? 'Listing failed', 'danger');
            else setListOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The "no surprises" confirmation: everything the player is about to approve. */
function BuyConfirm({
  listing,
  busy,
  onClose,
  onConfirm,
}: {
  listing: Listing;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const preview = buildBuyPreview({
    assetName: listing.assetName,
    priceWei: BigInt(listing.priceWei),
    feeBps: FEE_BPS,
    paymentToken: listing.paymentToken,
  });

  return (
    <Modal
      title="CONFIRM PURCHASE"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>
            {busy ? 'PROCESSING…' : 'CONFIRM & PAY'}
          </button>
          <button className="btn" disabled={busy} onClick={onClose}>
            CANCEL
          </button>
        </>
      }
    >
      <p>{preview.summary}</p>

      <StatRow label="Asset" value={preview.assetName} />
      <StatRow label="Price" value={`${preview.priceEth} ETH`} tone="var(--gold)" />
      <StatRow label="Protocol fee" value={`${preview.feeEth} ETH`} />
      <StatRow label="Seller receives" value={`${preview.sellerReceivesEth} ETH`} />
      <StatRow label="Payment" value={preview.paymentToken} />
      <StatRow label="Contract" value={isContractsConfigured() ? preview.contract : 'Game database (no contracts deployed)'} />

      <div style={{ marginTop: 14 }}>
        {preview.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
      </div>
    </Modal>
  );
}

/** Listing flow: pick an asset, set a price, see the fee breakdown. */
function ListAsset({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (body: { assetKind: 'SHIP' | 'ITEM'; assetId: string; priceEth: string; durationHours?: number }) => Promise<void>;
}) {
  const { profile } = useGame();
  const [assetId, setAssetId] = useState('');
  const [price, setPrice] = useState('0.05');
  const [hours, setHours] = useState(72);
  const [busy, setBusy] = useState(false);

  const listableItems = profile.inventory.filter((i) => i.state === 'TRADEABLE');
  const listableShips = profile.ships.filter((s) => !s.isStarter);

  const selectedItem = listableItems.find((i) => i.id === assetId);
  const selectedShip = listableShips.find((s) => s.id === assetId);
  const assetName = selectedItem?.name ?? selectedShip?.nickname ?? '—';

  const preview = buildListPreview({ assetName, priceEth: price, feeBps: FEE_BPS });

  return (
    <Modal
      title="LIST AN ASSET"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={busy || !assetId || Number(price) <= 0}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit({
                  assetKind: selectedShip ? 'SHIP' : 'ITEM',
                  assetId,
                  priceEth: price,
                  durationHours: hours,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'LISTING…' : 'CONFIRM LISTING'}
          </button>
          <button className="btn" onClick={onClose}>
            CANCEL
          </button>
        </>
      }
    >
      <p>
        Your asset moves into escrow. It stays yours until someone buys it — you can cancel at any time and reclaim it.
      </p>

      <label className="mono-dim" htmlFor="list-asset">
        ASSET
      </label>
      <select id="list-asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ width: '100%', marginTop: 6 }}>
        <option value="">Select an asset…</option>
        {listableShips.length > 0 ? (
          <optgroup label="Ships">
            {listableShips.map((s) => (
              <option key={s.id} value={s.id}>
                {s.nickname ?? s.shipKey} · Lv {s.level}
              </option>
            ))}
          </optgroup>
        ) : null}
        {listableItems.length > 0 ? (
          <optgroup label="Items">
            {listableItems.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} · {RARITY[i.rarity].name}
              </option>
            ))}
          </optgroup>
        ) : null}
      </select>

      <div className="btn-row" style={{ marginTop: 14 }}>
        <div style={{ flex: 1 }}>
          <label className="mono-dim" htmlFor="list-price">
            PRICE (ETH)
          </label>
          <input
            id="list-price"
            type="number"
            min="0"
            step="0.001"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label className="mono-dim" htmlFor="list-hours">
            DURATION (HOURS)
          </label>
          <input
            id="list-hours"
            type="number"
            min="1"
            max="720"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{ width: '100%', marginTop: 6 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 className="panel-title" style={{ fontSize: 12 }}>
          YOU WILL RECEIVE
        </h3>
        <StatRow label="Listing price" value={`${preview.priceEth} ETH`} />
        <StatRow label="Protocol fee" value={`${preview.feeEth} ETH`} />
        <StatRow label="Your proceeds" value={`${preview.sellerReceivesEth} ETH`} tone="var(--ok)" />
      </div>

      <div style={{ marginTop: 12 }}>
        {preview.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
      </div>
    </Modal>
  );
}
