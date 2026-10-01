import React, { useEffect, useRef, useState } from 'react';
import { WalletProvider } from './wallet/WalletProvider';
import { GameProvider } from './state/GameProvider';
import { createGameHost, type GameHost, type ShellMode } from './game/GameHost';
import { CommandCenter } from './components/CommandCenter';
import { HUD } from './components/HUD';

/**
 * App — the composition root.
 *
 * The Phaser canvas is mounted once and never unmounted; the React shell simply
 * decides which surface sits on top of it. That keeps the game loop alive across
 * every menu transition, so there is no reload hitch when a run starts.
 */

export function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<GameHost | null>(null);
  const [mode, setMode] = useState<ShellMode>('boot');

  useEffect(() => {
    if (!mountRef.current) return;
    const h = createGameHost(mountRef.current);
    setHost(h);
    setMode(h.getMode());
    const off = h.onModeChange(setMode);

    return () => {
      off();
      h.destroy();
    };
  }, []);

  const showCommandCenter = mode === 'menu' || mode === 'boot';
  const showHud = mode === 'playing';

  return (
    <WalletProvider>
      <GameProvider>
        <div className="app">
          <div className="game-canvas" ref={mountRef} />

          {showHud ? <HUD host={host} /> : null}

          {showCommandCenter ? <CommandCenter host={host} /> : null}

          {mode === 'boot' ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--bg-deep)',
                zIndex: 30,
                pointerEvents: 'none',
              }}
            >
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontSize: 28, letterSpacing: 4, color: 'var(--accent)' }}>
                  ROCKET RIFT
                </div>
                <div className="mono-dim" style={{ marginTop: 10 }}>
                  <span className="spinner" /> &nbsp;initialising flight systems…
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </GameProvider>
    </WalletProvider>
  );
}
