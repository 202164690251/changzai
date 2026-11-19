import { useEffect, useState, type ReactElement } from "react";
import "./splash.css";

export interface SplashScreenProps {
  onDone: () => void;
}

/** 启动欢迎页：只做一次轻量的品牌亮相，不阻塞后面的聊天初始化。 */
export function SplashScreen({ onDone }: SplashScreenProps): ReactElement {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hold = window.setTimeout(() => setLeaving(true), reduced ? 450 : 1450);
    const done = window.setTimeout(onDone, reduced ? 750 : 1950);
    return () => {
      window.clearTimeout(hold);
      window.clearTimeout(done);
    };
  }, [onDone]);

  return (
    <div className={`splash${leaving ? " is-leaving" : ""}`} role="status" aria-label="veyrimi 如晤 正在启动">
      <div className="splash-glow" aria-hidden="true" />
      <div className="splash-lockup">
        <div className="splash-mark-wrap">
          <img className="splash-mark" src="/brand/brand-mark.png" alt="" />
          <span className="splash-spark" aria-hidden="true" />
        </div>
        <div className="splash-word">
          <span className="splash-en">veyrimi</span>
          <span className="splash-divider" aria-hidden="true">|</span>
          <span className="splash-cn">如晤</span>
        </div>
        <p className="splash-slogan">见字如晤，见你亦是。</p>
      </div>
      <p className="splash-loading">正在把 ta 带回你身边</p>
    </div>
  );
}
