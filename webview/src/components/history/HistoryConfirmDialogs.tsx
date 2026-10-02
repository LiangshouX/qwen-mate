import { memo } from 'react';
import type { TFunction } from 'i18next';
import { stopPropagationHandler } from './HistoryListItem';

export interface HistoryConfirmDialogsProps {
  deletingSessionId: string | null;
  isDeletingSelected: boolean;
  selectedCount: number;
  t: TFunction;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDeleteSelected: () => void;
  onConfirmDeleteSelected: () => void;
}

export const HistoryConfirmDialogs = memo(({
  deletingSessionId,
  isDeletingSelected,
  selectedCount,
  t,
  onCancelDelete,
  onConfirmDelete,
  onCancelDeleteSelected,
  onConfirmDeleteSelected,
}: HistoryConfirmDialogsProps) => {
  return (
    <>
      {/* Delete confirmation dialog */}
      {deletingSessionId && (
        <div className="modal-overlay" onClick={onCancelDelete} role="presentation">
          <div className="modal-content" onClick={stopPropagationHandler}>
            <h3>{t('history.confirmDelete')}</h3>
            <p>{t('history.deleteMessage')}</p>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={onCancelDelete}>
                {t('common.cancel')}
              </button>
              <button className="modal-btn modal-btn-danger" onClick={onConfirmDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeletingSelected && (
        <div className="modal-overlay" onClick={onCancelDeleteSelected} role="presentation">
          <div className="modal-content" onClick={stopPropagationHandler} role="dialog" aria-modal="true" aria-labelledby="delete-selected-title">
            <h3 id="delete-selected-title">{t('history.confirmDeleteSelected')}</h3>
            <p>{t('history.deleteSelectedMessage', { count: selectedCount })}</p>
            <div className="modal-actions">
              <button className="modal-btn modal-btn-cancel" onClick={onCancelDeleteSelected}>
                {t('common.cancel')}
              </button>
              <button className="modal-btn modal-btn-danger" onClick={onConfirmDeleteSelected}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
});

HistoryConfirmDialogs.displayName = 'HistoryConfirmDialogs';
