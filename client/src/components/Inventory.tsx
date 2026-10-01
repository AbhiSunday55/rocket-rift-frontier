import React, { useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import {
  canDismantle,
  canList,
  canTrade,
  dismantleValue,
  filterByCategory,
  inventoryValue,
  sortInventory,
} from '../game/systems/InventorySystem';
import { RARITY, Rarity } from '../game/config/rarity';
import { getWeapon } from '../game/config/weapons';
import { Bar, EmptyState, ItemCard, Modal, Notice, Panel, StatRow } from './ui';
import type { InventoryItem, ItemCategory } from '../game/systems/types';

/**
 * Inventory — everything the player owns, with the ownership states that bridge
 * the game and Web3 made explicit.
 *
 * LOCKED    cannot leave the account (starter gear, soulbound collectibles)
 * TRADEABLE free to list or trade
 * LISTED    escrowed in a marketplace listing
 * EQUIPPED  currently in a loadout slot
 */

const CATEGORIES: (ItemCategory | 'ALL')[] = ['ALL', 'WEAPON', 'SKIN', 'EQUIPMENT', 'COLLECTIBLE', 'ACCESSORY'];
const SORTS = ['RARITY', 'NEWEST', 'NAME', 'VALUE'] as const;

export function Inventory() {
  const { profile, dismantle, equipItem, pushToast } = useGame();
  const [category, setCategory] = useState<ItemCategory | 'ALL'>('ALL');
  const [sort, setSort] = useState<(typeof SORTS)[number]>('RARITY');
  const [selected, setSelected] = useState<InventoryItem | null>(null);

  const items = useMemo(
    () => sortInventory(filterByCategory(profile.inventory, category), sort),
    [profile.inventory, category, sort]
  );

  const totalValue = inventoryValue(profile.inventory);
  const tradeable = profile.inventory.filter((i) => i.state === 'TRADEABLE').length;
  const listed = profile.inventory.filter((i) => i.state === 'LISTED').length;

  return (
    <>
      <Panel
        title="INVENTORY"
        actions={<span className="mono-dim">{profile.inventory.length} stacks · {totalValue.toLocaleString()} Scrap value</span>}
      >
        <div className="grid grid-4" style={{ marginBottom: 16 }}>
          <div className="card">
            <div className="mono-dim">TOTAL STACKS</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--accent)' }}>
              {profile.inventory.length}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">TRADEABLE</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--ok)' }}>
              {tradeable}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">LISTED</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--gold)' }}>
              {listed}
            </div>
          </div>
          <div className="card">
            <div className="mono-dim">DISMANTLE VALUE</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--gold)' }}>
              {totalValue.toLocaleString()}
            </div>
          </div>
        </div>

        <div className="filters">
          {CATEGORIES.map((c) => (
            <button key={c} className={`filter-chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <label className="mono-dim" htmlFor="inv-sort">
            SORT
          </label>
          <select id="inv-sort" value={sort} onChange={(e) => setSort(e.target.value as (typeof SORTS)[number])}>
            {SORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon="📦"
            title="NOTHING HERE YET"
            hint="Loot drops from every enemy you destroy. Fly a run and come back."
          />
        ) : (
          <div className="grid grid-3">
            {items.map((item) => (
              <ItemCard key={item.id} item={item} onClick={() => setSelected(item)} />
            ))}
          </div>
        )}
      </Panel>

      {selected ? (
        <ItemDetail
          item={selected}
          onClose={() => setSelected(null)}
          onDismantle={() => {
            const check = canDismantle(selected);
            if (!check.ok) {
              pushToast(check.reason ?? 'Cannot dismantle', 'warn');
              return;
            }
            dismantle(selected.id);
            setSelected(null);
          }}
          onEquip={(slot) => {
            equipItem(selected.id, slot);
            setSelected(null);
          }}
        />
      ) : null}
    </>
  );
}

function ItemDetail({
  item,
  onClose,
  onDismantle,
  onEquip,
}: {
  item: InventoryItem;
  onClose: () => void;
  onDismantle: () => void;
  onEquip: (slot: string) => void;
}) {
  const meta = RARITY[item.rarity] ?? RARITY[Rarity.COMMON];
  const weapon = item.category === 'WEAPON' ? getWeapon(item.itemKey) : null;
  const dismantleCheck = canDismantle(item);
  const listCheck = canList(item);
  const tradeCheck = canTrade(item);

  const equipSlot =
    item.category === 'WEAPON'
      ? weapon?.slot === 'SECONDARY'
        ? 'secondary'
        : weapon?.slot === 'ULTIMATE'
          ? 'ultimate'
          : 'primary'
      : item.category === 'SKIN'
        ? 'skin'
        : item.category === 'ACCESSORY'
          ? 'accessory'
          : 'equipment';

  return (
    <Modal
      title={item.name.toUpperCase()}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" onClick={() => onEquip(equipSlot)}>
            EQUIP
          </button>
          <button className="btn btn-danger" disabled={!dismantleCheck.ok} onClick={onDismantle}>
            DISMANTLE
          </button>
          <button className="btn" onClick={onClose}>
            CLOSE
          </button>
        </>
      }
    >
      <div className="flex-between" style={{ marginBottom: 12 }}>
        <span className="rarity-tag" style={{ color: meta.css }}>
          {meta.name}
        </span>
        <span className="mono-dim">{item.category}</span>
      </div>

      <StatRow label="State" value={item.state} />
      <StatRow label="Quantity" value={item.quantity} />
      <StatRow label="Level" value={item.level} />
      <StatRow label="Acquired via" value={item.acquiredVia} />
      <StatRow label="Acquired" value={new Date(item.acquiredAt).toLocaleString()} />
      <StatRow label="Dismantle value" value={`${dismantleValue(item)} Scrap`} />
      {item.tokenId ? <StatRow label="On-chain token" value={`#${item.tokenId}`} /> : null}

      {weapon ? (
        <div style={{ marginTop: 14 }}>
          <h3 className="panel-title" style={{ fontSize: 12 }}>
            WEAPON PROFILE
          </h3>
          <p className="card-sub">{weapon.blurb}</p>
          <StatRow label="Slot" value={weapon.slot} />
          <StatRow label="Pattern" value={weapon.pattern} />
          <StatRow label="Damage ×" value={weapon.damageMultiplier} />
          <StatRow label="Fire Rate ×" value={weapon.fireRateMultiplier} />
          <StatRow label="Projectiles" value={weapon.projectiles} />
          <StatRow label="Pierce" value={weapon.pierce} />
        </div>
      ) : null}

      <div style={{ marginTop: 14 }}>
        <h3 className="panel-title" style={{ fontSize: 12 }}>
          OWNERSHIP
        </h3>
        <div className="btn-row">
          <span className={`confirm-badge ${dismantleCheck.ok ? 'yes' : 'no'}`}>
            {dismantleCheck.ok ? 'DISMANTLE OK' : dismantleCheck.reason}
          </span>
          <span className={`confirm-badge ${listCheck.ok ? 'yes' : 'no'}`}>
            {listCheck.ok ? 'LISTABLE' : listCheck.reason}
          </span>
          <span className={`confirm-badge ${tradeCheck.ok ? 'yes' : 'no'}`}>
            {tradeCheck.ok ? 'TRADEABLE' : tradeCheck.reason}
          </span>
        </div>
      </div>

      {item.state === 'LOCKED' ? (
        <div style={{ marginTop: 12 }}>
          <Notice tone="warn">
            This item is bound to your account. It cannot be dismantled, listed, or traded — that is what makes it a
            reliable starting point.
          </Notice>
        </div>
      ) : null}
    </Modal>
  );
}
