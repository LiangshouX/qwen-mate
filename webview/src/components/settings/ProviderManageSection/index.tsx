import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import frameStyles from '../ImportExportDialog/style.module.less';
import styles from './style.module.less';
import { useProviderConfig } from './useProviderConfig';
import ProviderConfigDialog from './ProviderConfigDialog';
import ModelEditorDialog from './ModelEditorDialog';
import type {
  KeyStatus,
  ModelEntry,
  PresetProviderState,
  ProviderCatalogEntry,
  ProviderConfigOp,
  ProviderConfigResult,
} from '../../../types/providerConfig';

const BUILTIN_BUCKET_IDS = new Set([
  'openai',
  'openai-responses',
  'anthropic',
  'gemini',
  'vertex-ai',
  'qwen-oauth',
]);

interface ProviderManageSectionProps {
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

type DialogState =
  | { kind: 'provider'; entry: ProviderCatalogEntry; presetState?: PresetProviderState }
  | {
      kind: 'model';
      bucketId: string;
      bucketProtocol: string | null;
      entry?: ModelEntry;
      originalBaseUrl?: string;
    }
  | null;

type PendingDelete =
  | { mode: 'preset'; presetId: string; label: string }
  | { mode: 'bucket'; bucketId: string; label: string }
  | null;

function keyChipClass(status: KeyStatus): string {
  if (status === 'set') return styles.chipOk!;
  if (status === 'placeholder' || status === 'process') return styles.chipInfo!;
  return styles.chipMuted!;
}

function KeyChip({
  status,
  label,
}: {
  status: KeyStatus;
  label: string;
}) {
  return <span className={`${styles.chip} ${keyChipClass(status)}`}>{label}</span>;
}

/**
 * 供应商管理 — visual provider/model configuration over the CLI's own
 * settings-writer service. Reads are redacted snapshots (no key values ever);
 * writes go through the JSONC-preserving writer so settings.json stays
 * byte-compatible with what the CLI itself would produce.
 */
export default function ProviderManageSection({ addToast }: ProviderManageSectionProps) {
  const { t } = useTranslation();
  const { snapshot, loading, loadError, runOp, reload } = useProviderConfig();

  const [dialog, setDialog] = useState<DialogState>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const catalogById = useMemo(
    () => new Map((snapshot?.catalog ?? []).map((entry) => [entry.id, entry])),
    [snapshot?.catalog],
  );

  const bucketProtocol = (bucketId: string): string | null => {
    if (!snapshot) return null;
    if (BUILTIN_BUCKET_IDS.has(bucketId)) return bucketId;
    return snapshot.providerProtocol[bucketId] ?? null;
  };

  const fullEntry = (bucketId: string, model: { id: string; baseUrl?: string }): ModelEntry | undefined =>
    (snapshot?.buckets?.[bucketId] ?? []).find(
      (candidate) =>
        candidate.id === model.id && (candidate.baseUrl ?? '') === (model.baseUrl ?? ''),
    );

  const toggleExpanded = (key: string) =>
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));

  const handleOp = async (
    payload: ProviderConfigOp,
    successMessage?: string,
  ): Promise<ProviderConfigResult | null> => {
    setBusyKey(String(payload.op ?? 'op'));
    try {
      const result = await runOp(payload);
      if (result.ok) {
        if (successMessage) addToast(successMessage, 'success');
        return result;
      }
      addToast(result.message ?? t('settings.pm.errGeneric'), 'error');
      return null;
    } finally {
      setBusyKey(null);
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    const payload =
      target.mode === 'preset'
        ? { op: 'deleteProvider', mode: 'preset', presetId: target.presetId }
        : { op: 'deleteProvider', mode: 'bucket', bucketId: target.bucketId };
    await handleOp(payload, t('settings.pm.deleted', { name: target.label }));
  };

  const renderModelRows = (bucketId: string, models: { id: string; baseUrl?: string }[]) => {
    const protocol = bucketProtocol(bucketId);
    return models.map((model) => {
      const entry = fullEntry(bucketId, model) ?? ({ id: model.id } as ModelEntry);
      const isActive =
        snapshot?.selection.name === entry.id &&
        (!snapshot?.selection.baseUrl || snapshot.selection.baseUrl === (entry.baseUrl ?? ''));
      return (
        <div className={styles.modelRow} key={`${bucketId}::${entry.id}::${entry.baseUrl ?? ''}`}>
          <div className={styles.modelRowMain}>
            <span className={styles.modelRowId}>
              {entry.name && entry.name !== entry.id ? `${entry.name} — ${entry.id}` : entry.id}
            </span>
            <span className={styles.modelRowMeta}>
              {isActive && (
                <span className={`${styles.chip} ${styles.chipPrimary}`}>
                  {t('settings.pm.activeModel')}
                </span>
              )}
              {entry.baseUrl && <code>{entry.baseUrl}</code>}
              {entry.envKey && <code>{entry.envKey}</code>}
              {entry.wireApi && <span>{entry.wireApi}</span>}
              {entry.generationConfig?.contextWindowSize && (
                <span>
                  {Math.round(entry.generationConfig.contextWindowSize / 1000)}K ctx
                </span>
              )}
              {entry.imageOnly && (
                <span className={`${styles.chip} ${styles.chipMuted}`}>
                  {t('settings.pm.flag.imageOnly')}
                </span>
              )}
              {entry.voiceOnly && (
                <span className={`${styles.chip} ${styles.chipMuted}`}>
                  {t('settings.pm.flag.voiceOnly')}
                </span>
              )}
              {entry.realtimeOnly && (
                <span className={`${styles.chip} ${styles.chipMuted}`}>
                  {t('settings.pm.flag.realtimeOnly')}
                </span>
              )}
            </span>
          </div>
          <div className={styles.modelRowActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              title={t('common.edit') ?? 'edit'}
              onClick={() =>
                setDialog({
                  kind: 'model',
                  bucketId,
                  bucketProtocol: protocol,
                  entry,
                  originalBaseUrl: entry.baseUrl,
                })
              }
            >
              <span className="codicon codicon-edit" />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              title={t('common.delete') ?? 'delete'}
              onClick={async () => {
                const result = await handleOp({
                  op: 'deleteModel',
                  bucketId,
                  id: entry.id,
                  ...(entry.baseUrl ? { baseUrl: entry.baseUrl } : {}),
                });
                if (result?.ok) addToast(t('settings.pm.modelDeleted'), 'success');
              }}
            >
              <span className="codicon codicon-trash" />
            </button>
          </div>
        </div>
      );
    });
  };

  const renderModelPanel = (
    groupKey: string,
    bucketId: string,
    models: { id: string; baseUrl?: string }[],
    addLabelBucketId?: string,
  ) => {
    const open = Boolean(expanded[groupKey]);
    if (!open) return null;
    const protocol = bucketProtocol(addLabelBucketId ?? bucketId);
    const canAdd = Boolean(snapshot && bucketProtocol(bucketId));
    return (
      <div className={styles.modelPanel}>
        <div className={styles.modelPanelHeader}>
          <span className={styles.modelPanelTitle}>
            {t('settings.pm.modelsCount', { count: models.length })}
          </span>
          {canAdd && (
            <button
              type="button"
              className={`${styles.btn} ${styles.btnGhost}`}
              onClick={() =>
                setDialog({
                  kind: 'model',
                  bucketId,
                  bucketProtocol: protocol,
                })
              }
            >
              <span className="codicon codicon-add" />
              {t('settings.pm.addModel')}
            </button>
          )}
        </div>
        {models.length === 0 ? (
          <div className={styles.emptyHint}>{t('settings.pm.noModels')}</div>
        ) : (
          renderModelRows(bucketId, models)
        )}
      </div>
    );
  };

  const renderPresetCard = (state: PresetProviderState) => {
    const entry = catalogById.get(state.id);
    if (!entry) return null;
    const groupKey = `preset:${state.id}`;
    const keyLabel =
      state.keyStatus === 'set'
        ? t('settings.pm.keySet')
        : state.keyStatus === 'placeholder'
          ? t('settings.pm.keyPlaceholder')
          : state.keyStatus === 'process'
            ? t('settings.pm.keyProcess')
            : t('settings.pm.keyUnset');
    return (
      <div
        className={`${styles.card} ${state.configured ? styles.cardConfigured : ''}`}
        key={state.id}
        data-testid={`provider-card-${state.id}`}
      >
        <div className={styles.cardMain}>
          <div className={styles.cardIdentity}>
            <div className={styles.cardTitleRow}>
              <span className={styles.cardTitle}>{entry.label}</span>
              {state.configured ? (
                <span className={`${styles.chip} ${styles.chipPrimary}`}>
                  {t('settings.pm.modelsCount', { count: state.modelCount })}
                </span>
              ) : (
                <span className={`${styles.chip} ${styles.chipMuted}`}>
                  {t('settings.pm.notConfigured')}
                </span>
              )}
              {entry.envKey && (
                <KeyChip status={state.keyStatus} label={keyLabel} />
              )}
              {state.endpoint && <span className={styles.cardEndpoint}>{state.endpoint}</span>}
            </div>
            <span className={styles.cardDesc}>{entry.description}</span>
          </div>
          <div className={styles.cardActions}>
            {state.configured && (
              <button
                type="button"
                className={styles.btn}
                onClick={() => toggleExpanded(groupKey)}
              >
                <span className="codicon codicon-list-flat" />
                {expanded[groupKey]
                  ? t('settings.pm.collapseModels')
                  : t('settings.pm.expandModels')}
              </button>
            )}
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={() => setDialog({ kind: 'provider', entry, presetState: state })}
            >
              <span className="codicon codicon-settings-gear" />
              {state.configured ? t('settings.pm.configure') : t('settings.pm.connect')}
            </button>
            {state.configured && (
              <button
                type="button"
                className={`${styles.btn} ${styles.btnDanger}`}
                aria-label={t('settings.pm.confirmDeleteAction')}
                onClick={() =>
                  setPendingDelete({ mode: 'preset', presetId: state.id, label: entry.label })
                }
              >
                <span className="codicon codicon-trash" />
              </button>
            )}
          </div>
        </div>
        {renderModelPanel(groupKey, state.owned[0]?.bucketId ?? 'openai', state.owned, 'openai')}
      </div>
    );
  };

  const renderCustomBucketCard = (bucket: {
    bucketId: string;
    protocol: string | null;
    mapped: boolean;
    modelCount: number;
    envKeyNames: string[];
    keyStatuses: Record<string, KeyStatus>;
  }) => {
    const groupKey = `bucket:${bucket.bucketId}`;
    const entries = snapshot?.buckets?.[bucket.bucketId] ?? [];
    return (
      <div className={`${styles.card} ${styles.cardConfigured}`} key={bucket.bucketId}>
        <div className={styles.cardMain}>
          <div className={styles.cardIdentity}>
            <div className={styles.cardTitleRow}>
              <span className={styles.cardTitle}>{bucket.bucketId}</span>
              <span className={`${styles.chip} ${styles.chipMuted}`}>
                {bucket.protocol ?? t('settings.pm.unrouted')}
              </span>
              <span className={`${styles.chip} ${styles.chipPrimary}`}>
                {t('settings.pm.modelsCount', { count: bucket.modelCount })}
              </span>
              {bucket.envKeyNames.map((name) => (
                <KeyChip
                  key={name}
                  status={bucket.keyStatuses[name] ?? 'unset'}
                  label={`${name}: ${
                    bucket.keyStatuses[name] === 'set'
                      ? t('settings.pm.keySet')
                      : bucket.keyStatuses[name] === 'placeholder'
                        ? t('settings.pm.keyPlaceholder')
                        : bucket.keyStatuses[name] === 'process'
                          ? t('settings.pm.keyProcess')
                          : t('settings.pm.keyUnset')
                  }`}
                />
              ))}
            </div>
            <span className={styles.cardDesc}>{t('settings.pm.customBucketDesc')}</span>
          </div>
          <div className={styles.cardActions}>
            <button type="button" className={styles.btn} onClick={() => toggleExpanded(groupKey)}>
              <span className="codicon codicon-list-flat" />
              {expanded[groupKey] ? t('settings.pm.collapseModels') : t('settings.pm.expandModels')}
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnDanger}`}
              onClick={() =>
                setPendingDelete({
                  mode: 'bucket',
                  bucketId: bucket.bucketId,
                  label: bucket.bucketId,
                })
              }
            >
              <span className="codicon codicon-trash" />
            </button>
          </div>
        </div>
        {renderModelPanel(groupKey, bucket.bucketId, entries)}
      </div>
    );
  };

  const groups = useMemo(() => {
    if (!snapshot) return null;
    return {
      alibaba: snapshot.providers.filter((p) => p.uiGroup === 'alibaba'),
      thirdParty: snapshot.providers.filter((p) => p.uiGroup === 'third-party'),
      customPreset: snapshot.providers.filter((p) => p.uiGroup === 'custom'),
      unassignedEntries: snapshot.unassigned ?? {},
      customBuckets: snapshot.customBuckets ?? [],
    };
  }, [snapshot]);

  const unassignedCount = groups
    ? Object.values(groups.unassignedEntries).reduce((sum, list) => sum + list.length, 0)
    : 0;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <span className={styles.toolbarDesc}>{t('settings.pm.pageDesc')}</span>
        <button type="button" className={styles.reloadBtn} onClick={reload} disabled={loading}>
          <span className="codicon codicon-refresh" />
          {t('settings.pm.reload')}
        </button>
      </div>

      {snapshot?.parseError && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <span className={`codicon codicon-error ${styles.bannerIcon}`} />
          <span className={styles.bannerBody}>
            {t('settings.pm.parseError')}
            <br />
            <span className={styles.bannerPath}>{snapshot.parseError}</span>
          </span>
        </div>
      )}

      {snapshot?.projectOverride?.ownsModelProviders && (
        <div className={`${styles.banner} ${styles.bannerWarn}`}>
          <span className={`codicon codicon-warning ${styles.bannerIcon}`} />
          <span className={styles.bannerBody}>
            {t('settings.pm.projectOverride')}
            <br />
            <span className={styles.bannerPath}>{snapshot.projectOverride.path}</span>
          </span>
        </div>
      )}

      {loadError && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <span className={`codicon codicon-error ${styles.bannerIcon}`} />
          <span className={styles.bannerBody}>{loadError}</span>
        </div>
      )}

      {loading && !snapshot && (
        <div className={styles.loadingRow}>
          <span className={styles.spinner} />
          {t('settings.pm.loading')}
        </div>
      )}

      {snapshot && groups && (
        <>
          {groups.alibaba.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{t('settings.pm.groupAlibaba')}</span>
                <span className={styles.groupHairline} />
              </div>
              {groups.alibaba.map(renderPresetCard)}
            </section>
          )}

          {groups.thirdParty.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{t('settings.pm.groupThirdParty')}</span>
                <span className={styles.groupHairline} />
              </div>
              {groups.thirdParty.map(renderPresetCard)}
            </section>
          )}

          {groups.customPreset.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{t('settings.pm.groupCustom')}</span>
                <span className={styles.groupHairline} />
              </div>
              {groups.customPreset.map(renderPresetCard)}
            </section>
          )}

          {groups.customBuckets.length > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>{t('settings.pm.groupCustomBuckets')}</span>
                <span className={styles.groupHairline} />
              </div>
              {groups.customBuckets.map(renderCustomBucketCard)}
            </section>
          )}

          {unassignedCount > 0 && (
            <section className={styles.group}>
              <div className={styles.groupHeader}>
                <span className={styles.groupTitle}>
                  {t('settings.pm.groupUnassigned')} ({unassignedCount})
                </span>
                <span className={styles.groupHairline} />
              </div>
              {Object.entries(groups.unassignedEntries).map(([bucketId, entries]) => (
                <div className={`${styles.card} ${styles.cardConfigured}`} key={bucketId}>
                  <div className={styles.cardMain}>
                    <div className={styles.cardIdentity}>
                      <div className={styles.cardTitleRow}>
                        <span className={styles.cardTitle}>{bucketId}</span>
                        <span className={`${styles.chip} ${styles.chipMuted}`}>
                          {t('settings.pm.modelsCount', { count: entries.length })}
                        </span>
                      </div>
                      <span className={styles.cardDesc}>
                        {t('settings.pm.unassignedDesc')}
                      </span>
                    </div>
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.btn}
                        onClick={() => toggleExpanded(`unassigned:${bucketId}`)}
                      >
                        <span className="codicon codicon-list-flat" />
                        {expanded[`unassigned:${bucketId}`]
                          ? t('settings.pm.collapseModels')
                          : t('settings.pm.expandModels')}
                      </button>
                      <button
                        type="button"
                        className={`${styles.btn} ${styles.btnPrimary}`}
                        onClick={() =>
                          setDialog({
                            kind: 'model',
                            bucketId,
                            bucketProtocol: bucketProtocol(bucketId),
                          })
                        }
                      >
                        <span className="codicon codicon-add" />
                        {t('settings.pm.addModel')}
                      </button>
                    </div>
                  </div>
                  {renderModelPanel(`unassigned:${bucketId}`, bucketId, entries)}
                </div>
              ))}
            </section>
          )}
        </>
      )}

      {/* Configure preset / custom provider */}
      {dialog?.kind === 'provider' && snapshot && (
        <ProviderConfigDialog
          snapshot={snapshot}
          entry={dialog.entry}
          presetState={dialog.presetState}
          runOp={runOp}
          onDone={(result) => {
            setDialog(null);
            if (result.ok) addToast(t('settings.pm.saved'), 'success');
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Add / edit model */}
      {dialog?.kind === 'model' && (
        <ModelEditorDialog
          bucketId={dialog.bucketId}
          bucketProtocol={dialog.bucketProtocol}
          entry={dialog.entry}
          originalBaseUrl={dialog.originalBaseUrl}
          runOp={runOp}
          onDone={(result) => {
            setDialog(null);
            if (result.ok) addToast(t('settings.pm.saved'), 'success');
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {/* Delete confirmation */}
      {pendingDelete &&
        createPortal(
          <div
            className={frameStyles.overlay}
            onClick={(e) => {
              if (e.target === e.currentTarget) setPendingDelete(null);
            }}
          >
            <div className={frameStyles.dialog} style={{ maxWidth: 460 }}>
              <div className={frameStyles.dialogHeader}>
                <h3>{t('settings.pm.confirmDeleteTitle')}</h3>
                <button className={frameStyles.closeBtn} onClick={() => setPendingDelete(null)}>
                  <span className="codicon codicon-close" />
                </button>
              </div>
              <div className={frameStyles.dialogContent}>
                <p style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>
                  {t('settings.pm.confirmDeleteBody', { name: pendingDelete.label })}
                </p>
                <p
                  className={styles.fieldHint}
                  style={{ marginTop: 10, display: 'flex', gap: 6, alignItems: 'flex-start' }}
                >
                  <span className="codicon codicon-warning" style={{ color: '#e2a03f' }} />
                  {t('settings.pm.confirmDeleteKeyNote')}
                </p>
              </div>
              <div className={frameStyles.dialogFooter}>
                <div />
                <div className={frameStyles.dialogActions}>
                  <button className={frameStyles.btnCancel} onClick={() => setPendingDelete(null)}>
                    {t('common.cancel')}
                  </button>
                  <button
                    className={`${frameStyles.btnConfirm} ${busyKey ? styles.btnBusy : ''}`}
                    onClick={confirmDelete}
                    disabled={busyKey !== null}
                    style={{ background: '#d9534f', borderColor: '#d9534f' }}
                  >
                    {t('settings.pm.confirmDeleteAction')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
