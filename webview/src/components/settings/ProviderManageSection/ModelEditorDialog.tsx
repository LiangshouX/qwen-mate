import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import frameStyles from '../ImportExportDialog/style.module.less';
import styles from './style.module.less';
import type { GenerationConfig, ModelEntry, ProviderConfigOp, ProviderConfigResult } from '../../../types/providerConfig';

interface ModelEditorDialogProps {
  bucketId: string;
  /** Resolved protocol of the bucket (openai / anthropic / gemini / …). */
  bucketProtocol: string | null;
  /** Existing entry when editing; undefined when adding. */
  entry?: ModelEntry;
  originalBaseUrl?: string;
  runOp: (payload: ProviderConfigOp) => Promise<ProviderConfigResult>;
  onDone: (result: ProviderConfigResult) => void;
  onCancel: () => void;
}

const FLAG_KEYS = [
  'imageOnly',
  'voiceOnly',
  'realtimeOnly',
  'visionOnly',
  'fastOnly',
  'supportsImageGeneration',
] as const;

type FlagKey = (typeof FLAG_KEYS)[number];

function parseJsonField(raw: string, t: (k: string) => string): Record<string, unknown> | string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return t('settings.pm.errJsonObject');
    }
    return parsed as Record<string, unknown>;
  } catch {
    return t('settings.pm.errJsonInvalid');
  }
}

/**
 * Add or edit one modelProviders entry with the full ModelConfig surface
 * (identity, route, purpose flags, generation config) — hand-written-file
 * capability expressed as a form. Validation mirrors the CLI-side rules the
 * settings-writer service enforces again on submit.
 */
export default function ModelEditorDialog({
  bucketId,
  bucketProtocol,
  entry,
  originalBaseUrl,
  runOp,
  onDone,
  onCancel,
}: ModelEditorDialogProps) {
  const { t } = useTranslation();
  const gen: GenerationConfig = entry?.generationConfig ?? {};

  const [id, setId] = useState(entry?.id ?? '');
  const [name, setName] = useState(entry?.name ?? '');
  const [description, setDescription] = useState(entry?.description ?? '');
  const [baseUrl, setBaseUrl] = useState(entry?.baseUrl ?? '');
  const [envKey, setEnvKey] = useState(entry?.envKey ?? '');
  const [wireApi, setWireApi] = useState<string>(entry?.wireApi ?? '');
  const [flags, setFlags] = useState<Record<FlagKey, boolean>>(() => {
    const initial = {} as Record<FlagKey, boolean>;
    for (const key of FLAG_KEYS) initial[key] = Boolean(entry?.[key]);
    return initial;
  });
  const [contextWindow, setContextWindow] = useState(
    gen.contextWindowSize !== undefined ? String(gen.contextWindowSize) : '',
  );
  const [timeout, setTimeoutMs] = useState(
    gen.timeout !== undefined ? String(gen.timeout) : '',
  );
  const [maxRetries, setMaxRetries] = useState(
    gen.maxRetries !== undefined ? String(gen.maxRetries) : '',
  );
  const [temperature, setTemperature] = useState(
    gen.samplingParams?.temperature !== undefined ? String(gen.samplingParams.temperature) : '',
  );
  const [topP, setTopP] = useState(
    gen.samplingParams?.top_p !== undefined ? String(gen.samplingParams.top_p) : '',
  );
  const [maxTokens, setMaxTokens] = useState(
    gen.samplingParams?.max_tokens !== undefined ? String(gen.samplingParams.max_tokens) : '',
  );
  const [thinkingMandatory, setThinkingMandatory] = useState(
    Boolean(gen.thinkingMandatory),
  );
  const [modalities, setModalities] = useState<Record<string, boolean>>({
    image: Boolean(gen.modalities?.image),
    video: Boolean(gen.modalities?.video),
    audio: Boolean(gen.modalities?.audio),
    pdf: Boolean(gen.modalities?.pdf),
  });
  const [extraBody, setExtraBody] = useState(
    gen.extra_body ? JSON.stringify(gen.extra_body, null, 2) : '',
  );
  const [customHeaders, setCustomHeaders] = useState(
    gen.customHeaders ? JSON.stringify(gen.customHeaders, null, 2) : '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isOpenAiFamily =
    bucketProtocol === 'openai' || bucketProtocol === 'openai-responses';

  const validate = (): string | null => {
    if (!id.trim()) return t('settings.pm.errModelIdRequired');
    if (baseUrl.trim() && !/^https?:\/\//i.test(baseUrl.trim())) {
      return t('settings.pm.errBaseUrlScheme');
    }
    if (wireApi && !isOpenAiFamily) return t('settings.pm.errWireNotOpenai');
    if (wireApi && wireApi !== 'chat-completions' && wireApi !== 'responses') {
      return t('settings.pm.errWireApi');
    }
    const needsHttpsRoute = flags.imageOnly || flags.realtimeOnly || flags.supportsImageGeneration;
    if (needsHttpsRoute && !/^https:\/\//i.test(baseUrl.trim())) {
      return t('settings.pm.errImageHttps');
    }
    if (needsHttpsRoute && !envKey.trim()) return t('settings.pm.errEnvKeyRequired');
    if (flags.voiceOnly && wireApi === 'responses') return t('settings.pm.errVoiceChatOnly');
    if (envKey.trim() && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(envKey.trim())) {
      return t('settings.pm.errEnvKeyFormat');
    }
    if (parseJsonField(extraBody, t) !== null && typeof parseJsonField(extraBody, t) === 'string') {
      return parseJsonField(extraBody, t) as string;
    }
    if (
      parseJsonField(customHeaders, t) !== null &&
      typeof parseJsonField(customHeaders, t) === 'string'
    ) {
      return parseJsonField(customHeaders, t) as string;
    }
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
      const generationConfig: GenerationConfig = {};
      if (contextWindow) generationConfig.contextWindowSize = Number(contextWindow);
      if (timeout) generationConfig.timeout = Number(timeout);
      if (maxRetries) generationConfig.maxRetries = Number(maxRetries);
      const sampling: Record<string, number> = {};
      if (temperature) sampling.temperature = Number(temperature);
      if (topP) sampling.top_p = Number(topP);
      if (maxTokens) sampling.max_tokens = Number(maxTokens);
      if (Object.keys(sampling).length > 0) {
        generationConfig.samplingParams = sampling;
      }
      if (thinkingMandatory) generationConfig.thinkingMandatory = true;
      const activeModalities = Object.fromEntries(
        Object.entries(modalities).filter(([, on]) => on),
      );
      if (Object.keys(activeModalities).length > 0) {
        generationConfig.modalities = activeModalities;
      }
      const extraBodyParsed = parseJsonField(extraBody, t);
      if (extraBodyParsed !== null) {
        if (typeof extraBodyParsed === 'string') {
          setError(extraBodyParsed);
          return;
        }
        generationConfig.extra_body = extraBodyParsed;
      }
      const headersParsed = parseJsonField(customHeaders, t);
      if (headersParsed !== null) {
        if (typeof headersParsed === 'string') {
          setError(headersParsed);
          return;
        }
        generationConfig.customHeaders = headersParsed as Record<string, string>;
      }

      const model: ModelEntry = {
        id: id.trim(),
        name: name.trim() || id.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(envKey.trim() ? { envKey: envKey.trim() } : {}),
        ...(wireApi ? { wireApi: wireApi as 'chat-completions' | 'responses' } : {}),
        ...Object.fromEntries(FLAG_KEYS.filter((k) => flags[k]).map((k) => [k, true])),
        ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
      };

      const payload: ProviderConfigOp = {
        op: 'saveModel',
        bucketId,
        model,
        ...(entry ? { originalId: entry.id, originalBaseUrl } : {}),
      };
      const result = await runOp(payload);
      if (result.ok) onDone(result);
      else setError(result.message ?? t('settings.pm.errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  if (!mounted) return null;

  return createPortal(
    <div
      className={frameStyles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className={frameStyles.dialog} style={{ position: 'relative', maxWidth: 620 }}>
        {busy && (
          <div className={styles.dialogBusy}>
            <span className={styles.spinner} />
            {t('settings.pm.busy')}
          </div>
        )}

        <div className={frameStyles.dialogHeader}>
          <h3>{entry ? t('settings.pm.editModel') : t('settings.pm.addModelTitle')}</h3>
          <button className={frameStyles.closeBtn} onClick={onCancel} disabled={busy}>
            <span className="codicon codicon-close" />
          </button>
        </div>

        <div className={frameStyles.dialogContent}>
          <div className={styles.form}>
            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>{t('settings.pm.groupIdentity')}</span>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>
                    {t('settings.pm.fModelId')} <span style={{ color: '#d9534f' }}>*</span>
                  </label>
                  <input
                    className={`${styles.input} ${styles.inputMono}`}
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    placeholder="deepseek-v4-pro"
                    disabled={busy}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.fName')}</label>
                  <input
                    className={styles.input}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('settings.pm.fNamePh')}
                    disabled={busy}
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>{t('settings.pm.fDescription')}</label>
                <input
                  className={styles.input}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>{t('settings.pm.groupRoute')}</span>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.baseUrl')}</label>
                  <input
                    className={`${styles.input} ${styles.inputMono}`}
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://api.example.com/v1"
                    disabled={busy}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.envKey')}</label>
                  <input
                    className={`${styles.input} ${styles.inputMono}`}
                    value={envKey}
                    onChange={(e) => setEnvKey(e.target.value)}
                    placeholder="MY_API_KEY"
                    disabled={busy}
                  />
                  <span className={styles.fieldHint}>{t('settings.pm.envKeyHint')}</span>
                </div>
              </div>
              {isOpenAiFamily && (
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.wireApi')}</label>
                  <select
                    className={styles.select}
                    value={wireApi}
                    onChange={(e) => setWireApi(e.target.value)}
                    disabled={busy}
                  >
                    <option value="">—</option>
                    <option value="chat-completions">chat-completions</option>
                    <option value="responses">responses</option>
                  </select>
                </div>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>{t('settings.pm.flagsTitle')}</span>
              {FLAG_KEYS.map((key) => (
                <div className={styles.switchRow} key={key}>
                  <span className={styles.switchLabel}>
                    {t(`settings.pm.flag.${key}`)}
                    <span className={styles.switchHint}>{t(`settings.pm.flagHint.${key}`)}</span>
                  </span>
                  <span className={styles.switchBox}>
                    <input
                      type="checkbox"
                      checked={flags[key]}
                      onChange={(e) => setFlags((prev) => ({ ...prev, [key]: e.target.checked }))}
                      disabled={busy}
                    />
                    <span />
                  </span>
                </div>
              ))}
            </div>

            <div className={styles.fieldGroup}>
              <span className={styles.fieldGroupTitle}>{t('settings.pm.groupGeneration')}</span>
              <div className={styles.grid2}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.contextWindow')}</label>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    value={contextWindow}
                    placeholder="1000000"
                    onChange={(e) => setContextWindow(e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={busy}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.timeout')}</label>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    value={timeout}
                    placeholder="600000"
                    onChange={(e) => setTimeoutMs(e.target.value.replace(/[^0-9]/g, ''))}
                    disabled={busy}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.maxRetries')}</label>
                  <input
                    className={styles.input}
                    inputMode="numeric"
                    value={maxRetries}
                    placeholder="2"
                    onChange={(e) => setMaxRetries(e.target.value.replace(/[^0-9]/g, ''))}
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
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>{t('settings.pm.temperature')}</label>
                  <input
                    className={styles.input}
                    value={temperature}
                    placeholder="0.7"
                    onChange={(e) => setTemperature(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel}>top_p</label>
                  <input
                    className={styles.input}
                    value={topP}
                    placeholder="1.0"
                    onChange={(e) => setTopP(e.target.value)}
                    disabled={busy}
                  />
                </div>
              </div>

              <div className={styles.switchRow}>
                <span className={styles.switchLabel}>
                  {t('settings.pm.thinkingMandatory')}
                  <span className={styles.switchHint}>{t('settings.pm.thinkingMandatoryHint')}</span>
                </span>
                <span className={styles.switchBox}>
                  <input
                    type="checkbox"
                    checked={thinkingMandatory}
                    onChange={(e) => setThinkingMandatory(e.target.checked)}
                    disabled={busy}
                  />
                  <span />
                </span>
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
                        checked={modalities[m]}
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

              <div className={styles.field}>
                <label className={styles.fieldLabel}>extra_body (JSON)</label>
                <textarea
                  className={styles.textarea}
                  value={extraBody}
                  placeholder='{ "enable_thinking": true }'
                  onChange={(e) => setExtraBody(e.target.value)}
                  disabled={busy}
                />
                <span className={styles.fieldHint}>{t('settings.pm.extraBodyHint')}</span>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>customHeaders (JSON)</label>
                <textarea
                  className={styles.textarea}
                  value={customHeaders}
                  placeholder='{ "HTTP-Referer": "https://example.com" }'
                  onChange={(e) => setCustomHeaders(e.target.value)}
                  disabled={busy}
                />
              </div>
            </div>

            {error && <div className={styles.fieldError}>{error}</div>}
          </div>
        </div>

        <div className={frameStyles.dialogFooter}>
          <div className={styles.toolbarDesc}>{t('settings.pm.writeNote')}</div>
          <div className={frameStyles.dialogActions}>
            <button className={frameStyles.btnCancel} onClick={onCancel} disabled={busy}>
              {t('common.cancel')}
            </button>
            <button
              className={`${frameStyles.btnConfirm} ${busy ? styles.btnBusy : ''}`}
              onClick={submit}
              disabled={busy}
            >
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
