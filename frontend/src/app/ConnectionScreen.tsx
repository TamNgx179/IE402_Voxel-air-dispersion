import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n';
import { offlineArtwork, offlineLoader } from './offlineArtwork';
import './connection-screen.css';

type ConnectionScreenProps =
  | { offline: true; retrying?: never; onRetry?: never }
  | { offline?: false; retrying: boolean; onRetry: () => void };

export function ConnectionScreen({ offline, retrying, onRetry }: ConnectionScreenProps) {
  const { t } = useI18n();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), [offline]);
  return (
    <main className="connection-screen" aria-labelledby="connection-title">
      <div className="connection-screen__art">
        <img src={offlineArtwork} alt="" width="720" height="720" />
      </div>
      {(offline || retrying) && <img className="connection-screen__loader" src={offlineLoader} alt="" width="54" height="30" />}
      <div className="connection-screen__body">
        <h1 ref={title} tabIndex={-1} id="connection-title">
          {t(offline ? 'viewer.offlineTitle' : 'viewer.connectionTitle')}
        </h1>
        {offline && <p>{t('viewer.offlineRecovery')}</p>}
        {!offline && <>
        <p>{t('viewer.connectionHint')}</p>
        <button className="connection-screen__retry" type="button" disabled={retrying} onClick={onRetry}>
          <i className="bi bi-arrow-clockwise" aria-hidden="true" />
          <span aria-live="polite">{t(retrying ? 'viewer.reconnecting' : 'common.retry')}</span>
        </button>
        </>}
      </div>
    </main>
  );
}
