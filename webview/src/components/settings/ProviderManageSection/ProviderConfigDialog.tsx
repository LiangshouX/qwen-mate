import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import frameStyles from '../ImportExportDialog/style.module.less';
import styles from './style.module.less';
import type {
  CatalogBaseUrlOption,
  KeyStatus,
  PresetProviderState,
  ProviderCatalogEntry,
  ProviderConfigOp,
  ProviderConfigResult,
  ProviderConfigSnapshot,
  SaveCustomProviderInput,
  SavePresetProviderInput,
} from '../../../types/providerConfig';

interface ProviderConfigDialogProps {
  snapshot: ProviderConfigSnapshot;
  entry: ProviderCatalogEntry;
  /** Present when the provider is already configured (reconnect flow). */
  presetState?: PresetProviderState;
  runOp: (payload: ProviderConfigOp) => Promise<ProviderConfigResult>;
  onDone: (result: ProviderConfigResult) => void;
  onCancel: () => void;
}

const PROTOCOL_LABEL_KEYS: Record<string, string> = {
  openai: 'settings.pm.protocolOpenai',
  anthropic: 'settings.pm.protocolAnthropic',
  gemini: 'settings.pm.protocolGemini',
};

function statusOf(
  snapshot: ProviderConfigSnapshot,
  envKeyName: string | null,
): KeyStatus {
  if (!envKeyName) return 'unset';
  return snapshot.env[envKeyName]?.status ?? 'unset';
}

/**
 * Configure a preset provider (endpoint → API key → models) or Custom
 * Provider (protocol → wire API → endpoint → key → models → advanced).
 *
 * SECURITY: an already-stored key is never echoed back into the input — the
 * field starts empty every time and empty means "keep the stored key".
 */
export default function ProviderConfigDialog({
  snapshot,
  entry,
  presetState,
  runOp,
  onDone,
  onCancel,
}: ProviderConfigDialogProps) {
  const { t } = useTranslation();

  const endpointOptions = Array.isArray(entry.baseUrl) ? entry.baseUrl : null;
  const fixedEndpoint = typeof entry.baseUrl === 'string' ? entry.baseUrl : '';
  const isCustom = entry.id === 'custom-openai-compatible';
  const supportsProtocolChoice = (entry.protocolOptions?.length ?? 0) > 1;

  const initialEndpoint = (() => {
    if (presetState?.endpoint) return presetState.endpoint;
    if (endpointOptions?.length) {
      const firstVisible =
        endpointOptions.find((o) => !o.protocol || o.protocol === (entry.protocolOptions?.[0] ?? entry.protocol)) ??
        endpointOptions[0];
      return firstVisible.url;
    }
    return fixedEndpoint;
  })();

  const [protocol, setProtocol] = useState<string>(
    entry.protocolOptions?.[0] ?? entry.protocol,
  );
  const [wireApi, setWireApi] = useState<'chat-completions' | 'responses'>('chat-completions');
  const [endpoint, setEndpoint] = useState(initialEndpoint);
  // Option id discriminator — several options may share one URL (MiMo Token
  // Plan tiers) with different env keys, so the URL alone is not enough.
  const [endpointOptId, setEndpointOptId] = useState<string | undefined>(() => {
    if (!endpointOptions?.length) return undefined;
    const initialProtocol = entry.protocolOptions?.[0] ?? entry.protocol;
    const match =
      endpointOptions.find(
        (o) =>
          o.url === initialEndpoint &&
          (!o.protocol || o.protocol === initialProtocol),
      ) ??
      endpointOptions.find((o) => !o.protocol || o.protocol === initialProtocol);
    return match?.id;
  });
  const [baseUrlInput, setBaseUrlInput] = useState(fixedEndpoint || '');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const ownedIds = new Set((presetState?.owned ?? []).map((o) => o.id));
    const initial = new Set<string>();
    if (presetState?.configured && ownedIds.size > 0) {
      for (const spec of entry.models ?? []) {
        if (ownedIds.has(spec.id)) initial.add(spec.id);
      }
      // Owned ids that left the catalog template stay selected so a reconnect
      // does not silently drop them.
      for (const id of ownedIds) {
        if (!(entry.models ?? []).some((spec) => spec.id === id)) initial.add(id);
      }
      return initial;
    }
    for (const spec of entry.models ?? []) initial.add(spec.id);
    return initial;
  });
  const [search, setSearch] = useState('');
  const [freeId, setFreeId] = useState('');
  const [enableThinking, setEnableThinking] = useState(false);
  const [contextWindow, setContextWindow] = useState('');
  const [maxTokens, setMaxTokens] = useState('');
  const [modalities, setModalities] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // The key that matters is the one belonging to the SELECTED endpoint option
  // (MiMo tiers share a URL but write different keys per option).
  const selectedEndpointKey =
    (!isCustom && endpointOptions?.find((o) => o.id === endpointOptId)?.envKey) ||
    entry.envKey;
  const resolvedKeyStatus: KeyStatus = isCustom ? 'unset' : statusOf(snapshot, selectedEndpointKey);

  // Every key this provider can write (single-key presets fall back to the
  // provider envKey); multi-tier providers show one status chip per key.
  const allKeyNames = [
    ...new Set(
      [entry.envKey, ...(entry.optionEnvKeys ?? [])].filter(
        (key): key is string => typeof key === 'string' && key.length > 0,
      ),
    ),
  ];
  const keyStatusLabel = (status: KeyStatus): string =>
    status === 'set'
      ? t('settings.pm.keySet')
      : status === 'placeholder'
        ? t('settings.pm.keyPlaceholder')
        : status === 'process'
          ? t('settings.pm.keyProcess')
          : t('settings.pm.keyUnset');
  const keyChipClass = (status: KeyStatus): string =>
    status === 'set'
      ? styles.chipOk!
      : status === 'placeholder' || status === 'process'
        ? styles.chipInfo!
        : styles.chipMuted!;

  const effectiveBaseUrl = isCustom ? baseUrlInput.trim() : fixedEndpoint || endpoint;
  const hasStoredKey =
    resolvedKeyStatus === 'set' || resolvedKeyStatus === 'process' || resolvedKeyStatus === 'placeholder';

  const filteredSpecs = useMemo(() => {
    const specs = entry.models ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return specs;
    return specs.filter(
      (spec) =>
        spec.id.toLowerCase().includes(needle) ||
        (spec.description ?? '').toLowerCase().includes(needle),
    );
  }, [entry.models, search]);

  const toggleModel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addFreeId = () => {
    const id = freeId.trim();
    if (!id) return;
    setSelectedIds((prev) => new Set(prev).add(id));
    setFreeId('');
  };

  const validate = (): string | null => {
    if (supportsProtocolChoice || isCustom) {
      if (!entry.protocolOptions?.includes(protocol)) {
        return t('settings.pm.errProtocol');
      }
    }
    if (isCustom) {
      if (!effectiveBaseUrl) return t('settings.pm.errBaseUrlRequired');
      if (!/^https?:\/\//i.test(effectiveBaseUrl)) return t('settings.pm.errBaseUrlScheme');
    } else if (endpointOptions?.length) {
      const chosen = endpointOptions.find((o) => o.id === endpointOptId);
      if (!chosen || (chosen.protocol && chosen.protocol !== protocol)) {
        return t('settings.pm.errBaseUrlRequired');
      }
    } else if (!fixedEndpoint && !endpoint) {
      return t('settings.pm.errBaseUrlRequired');
    }
    if (entry.hasKeyValidator && apiKey && !apiKey.trim().startsWith('sk-sp-')) {
      return t('settings.pm.errSkPrefix');
    }
    if (!apiKey && !hasStoredKey && !clearKey) {
      return t('settings.pm.errKeyRequired');
    }
    if (selectedIds.size === 0) return t('settings.pm.errNoModels');
    return null;
  };

  const submit = async () => {
    setError(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      let result: ProviderConfigResult;
      if (isCustom) {
        const payload: SaveCustomProviderInput = {
          op: 'saveProvider',
          mode: 'custom',
          protocol: protocol as 'openai' | 'anthropic' | 'gemini',
          baseUrl: effectiveBaseUrl,
          modelIds: [...selectedIds],
          ...(wireApi !== 'chat-completions' ? { wireApi } : {}),
          ...(apiKey ? { apiKey: apiKey.trim() } : {}),
          ...(clearKey && !apiKey ? { clearKey: true } : {}),
          ...(enableThinking || contextWindow || maxTokens || Object.values(modalities).some(Boolean)
            ? {
                advanced: {
                  ...(enableThinking ? { enableThinking: true } : {}),
                  ...(contextWindow ? { contextWindowSize: Number(contextWindow) } : {}),
                  ...(maxTokens ? { maxTokens: Number(maxTokens) } : {}),
                  ...(Object.values(modalities).some(Boolean)
                    ? { multimodal: { ...modalities } }
                    : {}),
                },
              }
            : {}),
        };
        result = await runOp(payload);
      } else {
        const payload: SavePresetProviderInput = {
          op: 'saveProvider',
          mode: 'preset',
          presetId: entry.id,
          modelIds: [...selectedIds],
          ...(supportsProtocolChoice ? { protocol } : {}),
          ...(endpointOptId ? { endpointId: endpointOptId } : {}),
          ...(endpoint ? { baseUrl: endpoint } : {}),
          ...(apiKey ? { apiKey: apiKey.trim() } : {}),
          ...(clearKey && !apiKey ? { clearKey: true } : {}),
        };
        result = await runOp(payload);
      }
      if (result.ok) {
        onDone(result);
      } else {
        setError(result.message ?? t('settings.pm.errGeneric'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  const showEndpointStep = endpointOptions !== null || !fixedEndpoint;
  const showProtocolStep = supportsProtocolChoice;

  return createPortal(
    <div
      className={frameStyles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className={frameStyles.dialog} style={{ position: 'relative', maxWidth: 640 }}>
        {busy && (
          <div className={styles.dialogBusy}>
            <span className={styles.spinner} />
            {t('settings.pm.busy')}
          </div>
        )}

        <div className={frameStyles.dialogHeader}>
          <h3>
            {presetState?.configured
              ? t('settings.pm.configureTitle', { name: entry.label })
              : t('settings.pm.connectTitle', { name: entry.label })}
          </h3>
          <button className={frameStyles.closeBtn} onClick={onCancel} disabled={busy}>
            <span className="codicon codicon-close" />
          </button>
        </div>

        <div className={frameStyles.dialogContent}>
          <div className={styles.form}>
            <p className={styles.fieldHint}>{entry.description}</p>

            {showProtocolStep && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{t('settings.pm.protocol')}</label>
                <select
                  className={styles.select}
                  value={protocol}
                  onChange={(e) => {
                    const nextProtocol = e.target.value;
                    setProtocol(nextProtocol);
                    setWireApi('chat-completions');
                    // Endpoint options are protocol-tagged; re-pick the first
                    // one that belongs to the new protocol.
                    const first = endpointOptions?.find(
                      (o) => !o.protocol || o.protocol === nextProtocol,
                    );
                    if (first) {
                      setEndpoint(first.url);
                      setEndpointOptId(first.id);
                    }
                  }}
                >
                  {(entry.protocolOptions ?? []).map((p) => (
                    <option key={p} value={p}>
                      {t(PROTOCOL_LABEL_KEYS[p] ?? 'settings.pm.protocol')}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {isCustom && protocol === 'openai' && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{t('settings.pm.wireApi')}</label>
                <select
                  className={styles.select}
                  value={wireApi}
                  onChange={(e) => setWireApi(e.target.value as 'chat-completions' | 'responses')}
                >
                  <option value="chat-completions">chat-completions</option>
                  <option value="responses">responses</option>
                </select>
                <span className={styles.fieldHint}>{t('settings.pm.wireApiHint')}</span>
              </div>
            )}

            {showEndpointStep && endpointOptions && (
              <div className={styles.fieldGroup}>
                <span className={styles.fieldGroupTitle}>
                  {entry.uiLabels?.baseUrlStepTitle ?? t('settings.pm.endpoint')}
                </span>
                <div className={styles.endpointList}>
                  {endpointOptions
                    .filter((opt) => !opt.protocol || opt.protocol === protocol)
                    .map((opt: CatalogBaseUrlOption) => {
                    const active = endpointOptId === opt.id;
                    return (
                      <label
                        key={opt.id}
                        className={`${styles.endpointOption} ${active ? styles.endpointOptionActive : ''}`}
                      >
                        <input
                          type="radio"
                          name="pm-endpoint"
                          checked={active}
                          onChange={() => {
                            setEndpoint(opt.url);
                            setEndpointOptId(opt.id);
                          }}
                        />
                        <span className={styles.endpointBody}>
                          <span className={styles.endpointLabel}>{opt.label}</span>
                          <span className={styles.endpointUrl}>{opt.url}</span>
                          {(opt.documentationUrl || opt.apiKeyUrl) && (
                            <span className={styles.endpointLinks}>
                              {opt.documentationUrl && (
                                <a
                                  href={opt.documentationUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {t('settings.pm.docs')}
                                </a>
                              )}
                              {opt.apiKeyUrl && (
                                <a href={opt.apiKeyUrl} target="_blank" rel="noreferrer">
                                  {t('settings.pm.getApiKey')}
                                </a>
                              )}
                            </span>
                          )}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {showEndpointStep && !endpointOptions && (
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{t('settings.pm.baseUrl')}</label>
                <input
                  className={`${styles.input} ${styles.inputMono}`}
                  value={baseUrlInput}
                  placeholder={t('settings.pm.baseUrlPh')}
                  onChange={(e) => setBaseUrlInput(e.target.value)}
                  disabled={busy}
                />
                {entry.documentationUrl && (
                  <span className={styles.fieldHint}>
                    <a href={entry.documentationUrl} target="_blank" rel="noreferrer">
                      {t('settings.pm.docs')}
                    </a>
                  </span>
                )}
              </div>
            )}

            {/* API key — write-only: never prefilled, empty keeps the stored key */}
            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>{t('settings.pm.apiKey')}</span>
              <div className={styles.keyRow}>
                <input
                  type="password"
                  autoComplete="new-password"
                  className={styles.input}
                  value={apiKey}
                  placeholder={
                    !isCustom && hasStoredKey && !clearKey
                      ? t('settings.pm.keyKeepPlaceholder')
                      : (entry.apiKeyPlaceholder ?? 'sk-...')
                  }
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    if (e.target.value) setClearKey(false);
                  }}
                  disabled={busy}
                />
                {!isCustom && hasStoredKey && (
                  <button
                    className={`${styles.btn} ${clearKey ? styles.btnDanger : ''}`}
                    onClick={() => {
                      setClearKey((v) => !v);
                      if (!clearKey) setApiKey('');
                    }}
                    disabled={busy}
                    type="button"
                  >
                    {clearKey ? t('settings.pm.clearKeyArmed') : t('settings.pm.clearKey')}
                  </button>
                )}
              </div>
              {!isCustom && (
                <div className={styles.keyStatusLine}>
                  {allKeyNames.map((key) => {
                    const status = statusOf(snapshot, key);
                    return (
                      <span key={key} className={`${styles.chip} ${keyChipClass(status)}`}>
                        {allKeyNames.length > 1 ? `${key} · ` : ''}
                        {keyStatusLabel(status)}
                      </span>
                    );
                  })}
                  {allKeyNames.length === 1 && allKeyNames[0] && (
                    <code className={styles.bannerPath}>{allKeyNames[0]}</code>
                  )}
                  {hasStoredKey && (
                    <span>{t('settings.pm.keyNeverShown')}</span>
                  )}
                  {entry.hasKeyValidator && <span>{t('settings.pm.skPrefixHint')}</span>}
                </div>
              )}
              {isCustom && (
                <span className={styles.fieldHint}>{t('settings.pm.customKeyHint')}</span>
              )}
            </div>

            {/* Model selection */}
            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>
                {t('settings.pm.models')} ({selectedIds.size})
              </span>
              {entry.models && entry.models.length > 0 ? (
                <div className={styles.modelPicker}>
                  <div className={styles.modelPickerToolbar}>
                    <input
                      className={styles.input}
                      value={search}
                      placeholder={t('settings.pm.searchModels')}
                      onChange={(e) => setSearch(e.target.value)}
                      disabled={busy}
                    />
                  </div>
                  <div className={styles.modelPickerList}>
                    {filteredSpecs.map((spec) => (
                      <label key={spec.id} className={styles.modelPickRow}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(spec.id)}
                          onChange={() => toggleModel(spec.id)}
                          disabled={busy}
                        />
                        <span className={styles.modelPickBody}>
                          <span className={styles.modelPickId}>{spec.id}</span>
                          {spec.description && (
                            <span className={styles.modelPickDesc}>{spec.description}</span>
                          )}
                          <span className={styles.modelPickMeta}>
                            {spec.contextWindowSize
                              ? `${Math.round(spec.contextWindowSize / 1000)}K`
                              : ''}
                            {spec.enableThinking ? ` · ${t('settings.pm.thinking')}` : ''}
                            {spec.modalities?.image ? ` · ${t('settings.pm.modImage')}` : ''}
                            {spec.modalities?.video ? ` · ${t('settings.pm.modVideo')}` : ''}
                          </span>
                        </span>
                      </label>
                    ))}
                    {filteredSpecs.length === 0 && (
                      <div className={styles.emptyHint}>{t('settings.pm.noSearchResult')}</div>
                    )}
                  </div>
                  <div className={styles.freeIdRow}>
                    <input
                      className={`${styles.input} ${styles.inputMono}`}
                      value={freeId}
                      placeholder={t('settings.pm.freeIdPh')}
                      onChange={(e) => setFreeId(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addFreeId();
                        }
                      }}
                      disabled={busy}
                    />
                    <button
                      type="button"
                      className={styles.btn}
                      onClick={addFreeId}
                      disabled={busy || !freeId.trim()}
                    >
                      {t('settings.pm.addId')}
                    </button>
                  </div>
                  {selectedIds.size > 0 && (
                    <div className={styles.pickedChips}>
                      {[...selectedIds].map((id) => (
                        <span key={id} className={styles.pickedChip}>
                          {id}
                          <button type="button" onClick={() => toggleModel(id)} disabled={busy}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className={styles.field}>
                  <input
                    className={`${styles.input} ${styles.inputMono}`}
                    value={freeId}
                    placeholder={t('settings.pm.freeIdPhMulti')}
                    onChange={(e) => {
                      setFreeId(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addFreeId();
                      }
                    }}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    className={styles.btn}
                    onClick={addFreeId}
                    disabled={busy || !freeId.trim()}
                    style={{ alignSelf: 'flex-start' }}
                  >
                    {t('settings.pm.addId')}
                  </button>
                  {selectedIds.size > 0 && (
                    <div className={styles.pickedChips}>
                      {[...selectedIds].map((id) => (
                        <span key={id} className={styles.pickedChip}>
                          {id}
                          <button type="button" onClick={() => toggleModel(id)} disabled={busy}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Advanced (custom only — mirrors CLI's showAdvancedConfig step) */}
            {entry.showAdvancedConfig && (
              <div className={styles.fieldGroup}>
                <span className={styles.fieldGroupTitle}>{t('settings.pm.advanced')}</span>
                <div className={styles.switchRow}>
                  <span className={styles.switchLabel}>
                    {t('settings.pm.enableThinking')}
                    <span className={styles.switchHint}>{t('settings.pm.enableThinkingHint')}</span>
                  </span>
                  <span className={styles.switchBox}>
                    <input
                      type="checkbox"
                      checked={enableThinking}
                      onChange={(e) => setEnableThinking(e.target.checked)}
                      disabled={busy}
                    />
                    <span />
                  </span>
                </div>
                <div className={styles.grid2}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>{t('settings.pm.contextWindow')}</label>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      value={contextWindow}
                      placeholder={t('settings.pm.contextWindowPh')}
                      onChange={(e) => setContextWindow(e.target.value.replace(/[^0-9]/g, ''))}
                      disabled={busy}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>{t('settings.pm.maxTokens')}</label>
                    <input
                      className={styles.input}
                      inputMode="numeric"
                      value={maxTokens}
                      placeholder="—"
                      onChange={(e) => setMaxTokens(e.target.value.replace(/[^0-9]/g, ''))}
                      disabled={busy}
                    />
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.modalities')}</label>
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    {(['image', 'video', 'audio', 'pdf'] as const).map((m) => (
                      <label
                        key={m}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
                      >
                        <input
                          type="checkbox"
                          checked={Boolean(modalities[m])}
                          onChange={(e) =>
                            setModalities((prev) => ({ ...prev, [m]: e.target.checked }))
                          }
                          disabled={busy}
                        />
                        {t(
                          m === 'image'
                            ? 'settings.pm.modImage'
                            : m === 'video'
                              ? 'settings.pm.modVideo'
                              : m === 'audio'
                                ? 'settings.pm.modAudio'
                                : 'settings.pm.modPdf',
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {error && <div className={styles.fieldError}>{error}</div>}
          </div>
        </div>

        <div className={frameStyles.dialogFooter}>
          <div className={styles.toolbarDesc}>
            {t('settings.pm.writeNote')}
          </div>
          <div className={frameStyles.dialogActions}>
            <button className={frameStyles.btnCancel} onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              className={`${frameStyles.btnConfirm} ${busy ? styles.btnBusy : ''}`}
              onClick={submit}
              disabled={busy}
            >
              {presetState?.configured ? t('settings.pm.submitSave') : t('settings.pm.submitConnect')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
