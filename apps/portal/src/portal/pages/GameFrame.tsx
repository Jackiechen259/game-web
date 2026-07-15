import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { GameMetadata } from "@game-platform/game-schema";
import { DEFAULT_IFRAME_CONFIG, resolveEntryUrl } from "@game-platform/game-schema";
import { PortalBridge } from "@game-platform/game-sdk";

interface GameFrameProps {
  game: GameMetadata;
}

export function GameFrame({ game }: GameFrameProps): JSX.Element {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<PortalBridge | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [gameOver, setGameOver] = useState(false);

  const iframeConfig = game.iframe ?? DEFAULT_IFRAME_CONFIG;
  const allowAttr = iframeConfig.allow.join("; ");
  const sandboxAttr = iframeConfig.sandbox.join(" ");

  useEffect(() => {
    const bridge = new PortalBridge({
      gameId: game.id,
      target: iframeRef.current,
      selfOrigin: window.location.origin,
    });
    bridgeRef.current = bridge;
    bridge.on("GAME_READY", () => setLoading(false));
    bridge.on("ERROR", (payload) => {
      setErrorMsg(typeof payload === "string" ? payload : "Game reported an error.");
    });
    bridge.on("SCORE_UPDATED", (payload) => {
      if (typeof payload === "number") setScore(payload);
    });
    bridge.on("GAME_OVER", () => setGameOver(true));
    return () => {
      bridge.destroy();
      bridgeRef.current = null;
    };
  }, [game.id, reloadKey]);

  const handleFullscreen = (): void => {
    const el = iframeRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen?.();
    }
  };

  const handleRestart = (): void => {
    setScore(null);
    setGameOver(false);
    setErrorMsg(null);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const handleMute = (): void => {
    const next = !muted;
    setMuted(next);
    bridgeRef.current?.[next ? "mute" : "unmute"]();
  };

  const aspect = game.aspectRatio ?? "16/9";

  return (
    <div className="player">
      <div className="player-frame" style={{ aspectRatio: aspect }}>
        <iframe
          key={reloadKey}
          ref={iframeRef}
          title={game.title}
          src={resolveEntryUrl(game.entry)}
          allow={allowAttr}
          sandbox={sandboxAttr}
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
        />
        {loading ? <div className="player-loading"><span className="spinner" /> 加载中…</div> : null}
        {errorMsg ? <div className="player-error">⚠ {errorMsg}</div> : null}
      </div>

      <div className="player-controls">
        <Link to="/games" className="btn btn-sm">返回列表</Link>
        <button className="btn btn-sm" onClick={handleRestart} aria-label="重启游戏">重启</button>
        <button className="btn btn-sm" onClick={handleFullscreen} aria-label="全屏">全屏</button>
        <button className="btn btn-sm" onClick={handleMute} aria-pressed={muted}>{muted ? "取消静音" : "静音"}</button>
        <span className="spacer" />
        {score !== null ? <span className="badge">分数 {score}</span> : null}
        {gameOver ? <span className="badge badge-archived">游戏结束</span> : null}
      </div>

      {game.controls && game.controls.length > 0 ? (
        <div className="alert alert-info">
          <strong>操作说明</strong>
          <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.2rem" }}>
            {game.controls.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
