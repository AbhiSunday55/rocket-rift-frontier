import React, { useEffect, useMemo, useState } from 'react';
import { useGame } from '../state/GameProvider';
import { useWallet } from '../wallet/WalletProvider';
import { buildTradePreview } from '../wallet/contracts';
import { RARITY, Rarity } from '../game/config/rarity';
import { EmptyState, Modal, Notice, Panel, RarityTag, StatRow, timeAgo } from './ui';

/**
 * Trade — player-to-player swaps.
 *
 * Both sides must confirm before anything moves, and the confirmation is signed
 * with the wallet so there is a cryptographic record of who agreed to what.
 *
 * ⚠️ The UI is explicit that off-platform trades have no protection — that is
 * the single most common way players get scammed in games like this.
 */

export function Trade() {
  const { trades, refreshTrades, createTrade, confirmTrade, cancelTrade, profile, apiOnline, authenticated, pushToast } =
    useGame();
  const wallet = useWallet();
  const [composeOpen, setComposeOpen] = useState(false);

  useEffect(() => {
    refreshTrades();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiOnline, authenticated]);

  const incoming = trades.filter((t) => t.counterpartyId === profile.id);
  const outgoing = trades.filter((t) => t.initiatorId === profile.id);

  return (
    <>
      <Panel
        title="P2P TRADING"
        actions={
          <div className="btn-row">
            <span className="mono-dim">{trades.length} open offer(s)</span>
            <button className="btn btn-primary btn-sm" onClick={() => setComposeOpen(true)}>
              + NEW OFFER
            </button>
          </div>
        }
      >
        <Notice tone="danger">
          <b>Never trade outside the in-game flow.</b> Off-platform trades have no escrow, no confirmation step, and no
          recourse. If someone asks you to send an item first, it is a scam.
        </Notice>

        {!authenticated ? (
          <Notice tone="warn">
            P2P trading needs a connected wallet and a reachable game server, so both sides can be identified and the swap
            can be recorded. Connect a wallet from the top bar to enable it.
          </Notice>
        ) : null}

        {trades.length === 0 ? (
          <EmptyState
            icon="🤝"
            title="NO OPEN TRADES"
            hint="Create an offer to swap items or Plasma with another pilot."
          />
        ) : (
          <div className="grid grid-2">
            {[...incoming, ...outgoing].map((trade) => {
              const isIncoming = trade.counterpartyId === profile.id;
              const myConfirmed = isIncoming ? trade.counterpartyConfirmed : trade.initiatorConfirmed;
              const theirConfirmed = isIncoming ? trade.initiatorConfirmed : trade.counterpartyConfirmed;
              const giving = isIncoming ? trade.requestedAssets : trade.offeredAssets;
              const receiving = isIncoming ? trade.offeredAssets : trade.requestedAssets;
              const givingPlasma = isIncoming ? trade.requestedPlasma : trade.offeredPlasma;
              const receivingPlasma = isIncoming ? trade.offeredPlasma : trade.requestedPlasma;

              return (
                <div key={trade.id} className="card">
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <h3 className="card-name">
                      {isIncoming ? `FROM ${trade.initiatorName}` : `TO ${trade.counterpartyName}`}
                    </h3>
                    <span className="mono-dim">{trade.status}</span>
                  </div>

                  <div className="trade-columns">
                    <div>
                      <div className="mono-dim" style={{ marginBottom: 6 }}>
                        YOU GIVE
                      </div>
                      {giving.length === 0 && givingPlasma === 0 ? (
                        <div className="mono-dim">Nothing</div>
                      ) : (
                        <>
                          {giving.map((a) => (
                            <div key={a.itemKey} className="trade-slot">
                              <span>{a.name}</span>
                              <RarityTag rarity={a.rarity as Rarity} />
                            </div>
                          ))}
                          {givingPlasma > 0 ? (
                            <div className="trade-slot">
                              <span>Plasma</span>
                              <span style={{ color: 'var(--accent)' }}>{givingPlasma}</span>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>

                    <div style={{ alignSelf: 'center', fontSize: 22, color: 'var(--accent)' }} aria-hidden>
                      ⇄
                    </div>

                    <div>
                      <div className="mono-dim" style={{ marginBottom: 6 }}>
                        YOU RECEIVE
                      </div>
                      {receiving.length === 0 && receivingPlasma === 0 ? (
                        <div className="mono-dim">Nothing</div>
                      ) : (
                        <>
                          {receiving.map((a) => (
                            <div key={a.itemKey} className="trade-slot">
                              <span>{a.name}</span>
                              <RarityTag rarity={a.rarity as Rarity} />
                            </div>
                          ))}
                          {receivingPlasma > 0 ? (
                            <div className="trade-slot">
                              <span>Plasma</span>
                              <span style={{ color: 'var(--accent)' }}>{receivingPlasma}</span>
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </div>

                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <span className={`confirm-badge ${myConfirmed ? 'yes' : 'no'}`}>
                      {myConfirmed ? 'YOU CONFIRMED' : 'AWAITING YOU'}
                    </span>
                    <span className={`confirm-badge ${theirConfirmed ? 'yes' : 'no'}`}>
                      {theirConfirmed ? 'THEY CONFIRMED' : 'AWAITING THEM'}
                    </span>
                    <span className="mono-dim">{timeAgo(trade.createdAt)}</span>
                  </div>

                  <div className="btn-row" style={{ marginTop: 10 }}>
                    {!myConfirmed && trade.status !== 'SETTLED' && trade.status !== 'CANCELLED' ? (
                      <button className="btn btn-sm btn-primary" onClick={() => confirmTrade(trade.id)}>
                        {wallet.connection ? 'SIGN & CONFIRM' : 'CONFIRM'}
                      </button>
                    ) : null}
                    {trade.status !== 'SETTLED' && trade.status !== 'CANCELLED' ? (
                      <button className="btn btn-sm btn-danger" onClick={() => cancelTrade(trade.id)}>
                        CANCEL
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      {composeOpen ? (
        <ComposeTrade
          onClose={() => setComposeOpen(false)}
          onSubmit={async (body) => {
            const res = await createTrade(body);
            if (!res.ok) pushToast(res.reason ?? 'Could not create offer', 'danger');
            else setComposeOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function ComposeTrade({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (body: {
    counterpartyId: string;
    offeredAssets: { itemKey: string; quantity: number }[];
    requestedAssets: { itemKey: string; quantity: number }[];
    offeredPlasma: number;
    requestedPlasma: number;
  }) => Promise<void>;
}) {
  const { profile } = useGame();
  const [counterparty, setCounterparty] = useState('');
  const [offered, setOffered] = useState<string[]>([]);
  const [requested, setRequested] = useState<string[]>([]);
  const [offeredPlasma, setOfferedPlasma] = useState(0);
  const [requestedPlasma, setRequestedPlasma] = useState(0);
  const [busy, setBusy] = useState(false);

  const tradeable = useMemo(() => profile.inventory.filter((i) => i.state === 'TRADEABLE'), [profile.inventory]);

  const toggle = (list: string[], setList: (v: string[]) => void, id: string) => {
    setList(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  const offeredNames = offered.map((id) => tradeable.find((i) => i.id === id)?.name ?? id);
  const requestedNames = requested.map((id) => tradeable.find((i) => i.id === id)?.name ?? id);

  const preview = buildTradePreview({
    giving: offeredNames,
    receiving: requestedNames,
    givingPlasma: offeredPlasma,
    receivingPlasma: requestedPlasma,
  });

  return (
    <Modal
      title="NEW TRADE OFFER"
      onClose={onClose}
      footer={
        <>
          <button
            className="btn btn-primary"
            disabled={busy || !counterparty.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onSubmit({
                  counterpartyId: counterparty.trim(),
                  offeredAssets: offered.map((id) => ({ itemKey: id, quantity: 1 })),
                  requestedAssets: requested.map((id) => ({ itemKey: id, quantity: 1 })),
                  offeredPlasma,
                  requestedPlasma,
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'SENDING…' : 'SEND OFFER'}
          </button>
          <button className="btn" onClick={onClose}>
            CANCEL
          </button>
        </>
      }
    >
      <p>Both pilots must confirm before anything moves. You can cancel at any time before settlement.</p>

      <label className="mono-dim" htmlFor="trade-counterparty">
        COUNTERPARTY (PILOT ID OR WALLET)
      </label>
      <input
        id="trade-counterparty"
        value={counterparty}
        onChange={(e) => setCounterparty(e.target.value)}
        placeholder="0x… or pilot id"
        style={{ width: '100%', marginTop: 6 }}
      />

      <div className="trade-columns" style={{ marginTop: 16 }}>
        <div>
          <div className="mono-dim" style={{ marginBottom: 6 }}>
            YOU OFFER
          </div>
          {tradeable.length === 0 ? (
            <div className="mono-dim">No tradeable items.</div>
          ) : (
            tradeable.map((item) => (
              <div
                key={item.id}
                className="trade-slot"
                style={{ cursor: 'pointer', borderColor: offered.includes(item.id) ? 'var(--accent)' : undefined }}
                onClick={() => toggle(offered, setOffered, item.id)}
              >
                <span>{item.name}</span>
                <span style={{ color: RARITY[item.rarity].css }}>{RARITY[item.rarity].name}</span>
              </div>
            ))
          )}
          <label className="mono-dim" htmlFor="offer-plasma" style={{ display: 'block', marginTop: 10 }}>
            PLASMA TO OFFER
          </label>
          <input
            id="offer-plasma"
            type="number"
            min="0"
            max={profile.plasma}
            value={offeredPlasma}
            onChange={(e) => setOfferedPlasma(Math.max(0, Math.min(profile.plasma, Number(e.target.value))))}
            style={{ width: '100%', marginTop: 6 }}
          />
        </div>

        <div style={{ alignSelf: 'center', fontSize: 22, color: 'var(--accent)' }} aria-hidden>
          ⇄
        </div>

        <div>
          <div className="mono-dim" style={{ marginBottom: 6 }}>
            YOU REQUEST
          </div>
          <div className="mono-dim">
            Requested items are specified by the other pilot when they accept — describe what you want in the offer, or
            leave it empty for a gift.
          </div>
          <label className="mono-dim" htmlFor="request-plasma" style={{ display: 'block', marginTop: 10 }}>
            PLASMA TO REQUEST
          </label>
          <input
            id="request-plasma"
            type="number"
            min="0"
            value={requestedPlasma}
            onChange={(e) => setRequestedPlasma(Math.max(0, Number(e.target.value)))}
            style={{ width: '100%', marginTop: 6 }}
          />
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <h3 className="panel-title" style={{ fontSize: 12 }}>
          SUMMARY
        </h3>
        <p className="card-sub">{preview.summary}</p>
        {preview.warnings.map((w) => (
          <Notice key={w} tone="warn">
            {w}
          </Notice>
        ))}
      </div>
    </Modal>
  );
}
