import { useCallback, type RefObject } from 'react';
import type { TFunction } from 'i18next';
import { sendBridgeEvent } from '../utils/bridge';
import type { QwenMateContentBlock, QwenMateMessage } from '../types';
import type { Attachment, ChatInputBoxHandle, PermissionMode, ReasoningEffort, SelectedAgent } from '../components/ChatInputBox/types';
import { REASONING_LEVELS } from '../components/ChatInputBox/types';
import { expandQuoteTokens } from '../components/ChatInputBox/utils/quoteRegistry';
import type { ViewMode } from './useModelProviderState';

/**
 * Command sets for local handling (shared with App.tsx to avoid duplication)
 */
export const NEW_SESSION_COMMANDS = new Set(['/new', '/clear', '/reset']);
export const RESUME_COMMANDS = new Set(['/resume', '/continue']);
export const PLAN_COMMANDS = new Set(['/plan']);
export const CONTEXT_COMMANDS = new Set(['/context']);
/**
 * Locally handled commands, one per settings tab. The CLI rejects both with
 * "not supported in this mode" / exit code 1, so they must never reach
 * send_message — each opens its own settings page instead.
 */
export const MCP_COMMANDS = new Set(['/mcp']);
export const SKILLS_COMMANDS = new Set(['/skills']);
/**
 * Reasoning-effort command. The CLI answers a bare /effort with its interactive
 * picker; headless it only prints text, so the GUI intercepts both shapes and
 * drives the same selector state the input-box menu uses.
 */
export const EFFORT_COMMANDS = new Set(['/effort']);

// Hoisted regex to avoid creating new RegExp on every call
const WHITESPACE_REGEX = /\s+/;

function createContextUsageRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `context-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface UseMessageSenderOptions {
  t: TFunction;
  addToast: (message: string, type?: 'info' | 'success' | 'warning' | 'error') => void;
  currentProvider: string;
  selectedModel: string;
  permissionMode: PermissionMode;
  reasoningEffort: ReasoningEffort;
  selectedAgent: SelectedAgent | null;
  sdkStatusLoading: boolean;
  currentSdkInstalled: boolean;
  sentAttachmentsRef: RefObject<Map<string, Array<{ fileName: string; mediaType: string }>>>;
  chatInputRef: RefObject<ChatInputBoxHandle | null>;
  messagesContainerRef: RefObject<HTMLDivElement | null>;
  isUserAtBottomRef: RefObject<boolean>;
  userPausedRef: RefObject<boolean>;
  isStreamingRef: RefObject<boolean>;
  setMessages: React.Dispatch<React.SetStateAction<QwenMateMessage[]>>;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setLoadingStartTime: React.Dispatch<React.SetStateAction<number | null>>;
  setStreamingActive: React.Dispatch<React.SetStateAction<boolean>>;
  setSettingsInitialTab: React.Dispatch<React.SetStateAction<any>>;
  setCurrentView: React.Dispatch<React.SetStateAction<ViewMode>>;
  forceCreateNewSession: () => void;
  handleModeSelect?: (mode: PermissionMode) => void;
  /** Applies a reasoning tier from /effort — same state the selector menu writes. */
  setReasoningEffort?: (effort: ReasoningEffort) => void;
  openContextUsageDialog: (requestId?: string | null, loading?: boolean) => void;
  closeContextUsageDialog: (requestId?: string | null) => boolean;
}

/**
 * Handles message building, validation, and sending to the backend.
 */
export function useMessageSender({
  t,
  addToast,
  currentProvider,
  selectedModel,
  permissionMode,
  reasoningEffort,
  selectedAgent,
  sdkStatusLoading,
  currentSdkInstalled,
  sentAttachmentsRef,
  chatInputRef,
  messagesContainerRef,
  isUserAtBottomRef,
  userPausedRef,
  isStreamingRef,
  setMessages,
  setLoading,
  setLoadingStartTime,
  setStreamingActive,
  setSettingsInitialTab,
  setCurrentView,
  forceCreateNewSession,
  handleModeSelect,
  setReasoningEffort,
  openContextUsageDialog,
  closeContextUsageDialog,
}: UseMessageSenderOptions) {
  /**
   * Check if the input is a new session command
   */
  const checkNewSessionCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;
    const command = text.split(/\s+/)[0].toLowerCase();
    if (NEW_SESSION_COMMANDS.has(command)) {
      forceCreateNewSession();
      return true;
    }
    return false;
  }, [forceCreateNewSession]);

  /**
   * Check for local-handled slash commands (/resume, /plan)
   * Returns true if the command was handled locally
   * Note: This is also checked in App.tsx handleSubmit to bypass loading queue
   */
  const checkLocalCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;
    const command = text.split(/\s+/)[0].toLowerCase();

    // /resume - open history view
    if (RESUME_COMMANDS.has(command)) {
      setCurrentView('history');
      return true;
    }

    // /plan - switch to plan mode (Qwen only)
    if (PLAN_COMMANDS.has(command) && currentProvider === 'qwen') {
      if (handleModeSelect) {
        handleModeSelect('plan');
        addToast(t('chat.planModeEnabled', { defaultValue: 'Plan mode enabled' }), 'info');
      }
      return true;
    }

    return false;
  }, [setCurrentView, handleModeSelect, currentProvider, addToast, t]);

  /**
   * Check for context usage command (/context)
   * Only available for the Qwen provider (the Qwen SDK exposes getContextUsage).
   * Opens a dialog to display context window usage.
   */
  const checkContextCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;
    const command = text.split(WHITESPACE_REGEX)[0].toLowerCase();
    if (CONTEXT_COMMANDS.has(command)) {
      if (currentProvider !== 'qwen') {
        addToast(t('chat.commandProviderOnly', {
          command,
          provider: 'Qwen',
          defaultValue: `${command} is only available for the Qwen provider`,
        }), 'warning');
        return true;
      }

      const requestId = createContextUsageRequestId();

      // Open dialog with loading state immediately
      openContextUsageDialog(requestId, true);

      // Send bridge event to fetch context usage with current model
      const sent = sendBridgeEvent('get_context_usage', JSON.stringify({
        model: selectedModel,
        requestId,
      }));

      if (!sent) {
        closeContextUsageDialog(requestId);
        addToast(t('chat.bridgeUnavailable', {
          defaultValue: 'Bridge is not available right now',
        }), 'error');
      }
      return true;
    }
    return false;
  }, [currentProvider, selectedModel, addToast, t, openContextUsageDialog, closeContextUsageDialog]);

  /**
   * Check for settings-page commands (/mcp, /skills).
   * Handled locally and independently: /mcp opens the MCP servers tab,
   * /skills opens the Skills tab. The CLI rejects both in this mode, so they
   * must never be forwarded. Only the exact first token matches — /mcp-status
   * or other future commands are unaffected. Extra arguments are ignored.
   */
  const checkSettingsPageCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;
    const command = text.split(WHITESPACE_REGEX)[0].toLowerCase();

    if (MCP_COMMANDS.has(command)) {
      setSettingsInitialTab('mcp');
      setCurrentView('settings');
      return true;
    }

    if (SKILLS_COMMANDS.has(command)) {
      setSettingsInitialTab('skills');
      setCurrentView('settings');
      return true;
    }

    return false;
  }, [setSettingsInitialTab, setCurrentView]);

  /**
   * Check for the reasoning-effort command (/effort).
   * - Bare `/effort` opens the reasoning selector (the CLI's interactive
   *   picker equivalent — headless the CLI only prints text).
   * - `/effort <tier>` applies the tier to the same state the selector menu
   *   writes, so the input-box display follows immediately and every later
   *   send carries it (ai-bridge forwards it as the SDK `effort` option; the
   *   CLI clamps tiers the active model does not support). Never forwarded:
   *   the CLI runs in a fresh process per turn, so a change made there would
   *   be lost on the next turn anyway.
   */
  const checkEffortCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;
    const parts = text.split(WHITESPACE_REGEX);
    const command = parts[0].toLowerCase();
    if (!EFFORT_COMMANDS.has(command)) return false;

    const userMessage: QwenMateMessage = {
      type: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    // Bare /effort → open the selector instead of printing the CLI's text reply.
    const tierArg = (parts[1] || '').toLowerCase();
    if (!tierArg) {
      setMessages((prev) => [...prev, userMessage]);
      // Registered by ModelConfigSelect (same window-callback convention the
      // Java bridge uses): opens the model popover with the effort submenu
      // expanded — the GUI equivalent of the CLI's interactive /effort picker.
      window.openEffortSelector?.();
      return true;
    }

    const validTiers = REASONING_LEVELS.map((level) => level.id);
    if (!validTiers.includes(tierArg as ReasoningEffort)) {
      const assistantMessage: QwenMateMessage = {
        type: 'assistant',
        content: t('chat.effortInvalid', {
          tier: tierArg,
          tiers: validTiers.join(' / '),
          defaultValue: `Unknown effort tier "${tierArg}". Available: ${validTiers.join(', ')}`,
        }),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      return true;
    }

    const tier = tierArg as ReasoningEffort;
    setReasoningEffort?.(tier);
    const assistantMessage: QwenMateMessage = {
      type: 'assistant',
      content: t('chat.effortSet', {
        tier,
        defaultValue: `Reasoning effort set to ${tier}`,
      }),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    return true;
  }, [setReasoningEffort, setMessages, t]);

  /**
   * Check for unimplemented slash commands
   */
  const checkUnimplementedCommand = useCallback((text: string): boolean => {
    if (!text.startsWith('/')) return false;

    const command = text.split(/\s+/)[0].toLowerCase();
    const unimplementedCommands = ['/plugin', '/plugins'];

    if (unimplementedCommands.includes(command)) {
      const userMessage: QwenMateMessage = {
        type: 'user',
        content: text,
        timestamp: new Date().toISOString(),
      };
      const assistantMessage: QwenMateMessage = {
        type: 'assistant',
        content: t('chat.commandNotImplemented', { command }),
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      return true;
    }
    return false;
  }, [t, setMessages]);

  /**
   * Build content blocks for the user message
   */
  const buildUserContentBlocks = useCallback((
    text: string,
    attachments: Attachment[] | undefined
  ): QwenMateContentBlock[] => {
    const blocks: QwenMateContentBlock[] = [];

    const hasImageAttachments = Array.isArray(attachments) &&
      attachments.some(att => att.mediaType?.startsWith('image/'));

    if (Array.isArray(attachments) && attachments.length > 0) {
      for (const att of attachments) {
        if (att.mediaType?.startsWith('image/')) {
          blocks.push({
            type: 'image',
            src: `data:${att.mediaType};base64,${att.data}`,
            mediaType: att.mediaType,
          });
        } else {
          blocks.push({
            type: 'attachment',
            fileName: att.fileName,
            mediaType: att.mediaType,
          });
        }
      }
    }

    // Filter placeholder text: skip if there are image attachments and text is placeholder
    const isPlaceholderText = text && text.trim().startsWith('[Uploaded ');

    if (text && !(hasImageAttachments && isPlaceholderText)) {
      blocks.push({ type: 'text', text });
    }

    return blocks;
  }, []);

  /**
   * Send message to backend
   */
  const sendMessageToBackend = useCallback((
    text: string,
    attachments: Attachment[] | undefined,
    agentInfo: { id: string; name: string; prompt?: string } | null,
    fileTagsInfo: { displayPath: string; absolutePath: string }[] | null,
    requestedPermissionMode: PermissionMode
  ) => {
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;
    console.debug('[ModeSync][Frontend] send request mode', {
      provider: currentProvider,
      requestedMode: requestedPermissionMode,
      effectiveMode: requestedPermissionMode,
    });

    const reasoningEffortPayload = { reasoningEffort };

    if (hasAttachments) {
      try {
        const payload = JSON.stringify({
          text,
          attachments: (attachments || []).map(a => ({
            fileName: a.fileName,
            mediaType: a.mediaType,
            data: a.data,
          })),
          agent: agentInfo,
          fileTags: fileTagsInfo,
          permissionMode: requestedPermissionMode,
          ...reasoningEffortPayload,
        });
        sendBridgeEvent('send_message_with_attachments', payload);
      } catch (error) {
        console.error('[Frontend] Failed to serialize attachments payload', error);
        const fallbackPayload = JSON.stringify({
          text,
          agent: agentInfo,
          fileTags: fileTagsInfo,
          permissionMode: requestedPermissionMode,
          ...reasoningEffortPayload,
        });
        sendBridgeEvent('send_message', fallbackPayload);
      }
    } else {
      const payload = JSON.stringify({
        text,
        agent: agentInfo,
        fileTags: fileTagsInfo,
        permissionMode: requestedPermissionMode,
        ...reasoningEffortPayload,
      });
      sendBridgeEvent('send_message', payload);
    }
  }, [currentProvider, reasoningEffort]);

  /**
   * Execute message sending (from queue or directly)
   */
  const executeMessage = useCallback((content: string, attachments?: Attachment[]) => {
    // Expand inline quote chips (tokens) into their full Markdown blockquotes.
    const text = expandQuoteTokens(content).replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    if (!text && !hasAttachments) return;

    // Check SDK status
    if (sdkStatusLoading) {
      addToast(t('chat.sdkStatusLoading'), 'info');
      return;
    }
    if (!currentSdkInstalled) {
      addToast(
        t('chat.sdkNotInstalled', { provider: 'Qwen Code' }) + ' ' + t('chat.goInstallSdk'),
        'warning'
      );
      setSettingsInitialTab('dependencies');
      setCurrentView('settings');
      return;
    }

    // Build user message content blocks
    const userContentBlocks = buildUserContentBlocks(text, attachments);
    if (userContentBlocks.length === 0) return;

    // Persist non-image attachment metadata
    const nonImageAttachments = Array.isArray(attachments)
      ? attachments.filter(a => !a.mediaType?.startsWith('image/'))
      : [];
    if (nonImageAttachments.length > 0) {
      const MAX_ATTACHMENT_CACHE_SIZE = 100;
      if (sentAttachmentsRef.current.size >= MAX_ATTACHMENT_CACHE_SIZE) {
        const firstKey = sentAttachmentsRef.current.keys().next().value;
        if (firstKey !== undefined) {
          sentAttachmentsRef.current.delete(firstKey);
        }
      }
      sentAttachmentsRef.current.set(text || '', nonImageAttachments.map(a => ({
        fileName: a.fileName,
        mediaType: a.mediaType,
      })));
    }

    // Create and add user message (optimistic update)
    const userMessage: QwenMateMessage = {
      type: 'user',
      content: text || '',
      timestamp: new Date().toISOString(),
      isOptimistic: true,
      raw: { message: { content: userContentBlocks } },
    };
    setMessages((prev) => [...prev, userMessage]);

    // Set loading state
    setLoading(true);
    setLoadingStartTime(Date.now());

    // Scroll to bottom
    userPausedRef.current = false;
    isUserAtBottomRef.current = true;
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    });

    // Sync provider setting
    sendBridgeEvent('set_provider', currentProvider);

    // Build agent info
    const agentInfo = selectedAgent ? {
      id: selectedAgent.id,
      name: selectedAgent.name,
      prompt: selectedAgent.prompt,
    } : null;

    // Extract file tag info
    const fileTags = chatInputRef.current?.getFileTags() ?? [];
    const fileTagsInfo = fileTags.length > 0 ? fileTags.map(tag => ({
      displayPath: tag.displayPath,
      absolutePath: tag.absolutePath,
    })) : null;

    // Send message to backend
    sendMessageToBackend(text, attachments, agentInfo, fileTagsInfo, permissionMode);
  }, [
    sdkStatusLoading,
    currentSdkInstalled,
    currentProvider,
    permissionMode,
    selectedAgent,
    buildUserContentBlocks,
    sendMessageToBackend,
    addToast,
    t,
  ]);

  /**
   * Handle message submission (from ChatInputBox)
   */
  const handleSubmit = useCallback((content: string, attachments?: Attachment[]) => {
    const text = content.replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
    const hasAttachments = Array.isArray(attachments) && attachments.length > 0;

    if (!text && !hasAttachments) return;

    // Check new session commands
    if (checkNewSessionCommand(text)) return;

    // Check local-handled commands (/resume, /plan)
    if (checkLocalCommand(text)) return;

    // Check context usage command (/context)
    if (checkContextCommand(text)) return;

    // Check settings-page commands (/mcp, /skills)
    if (checkSettingsPageCommand(text)) return;

    // Check reasoning-effort command (/effort)
    if (checkEffortCommand(text)) return;

    // Check for unimplemented commands
    if (checkUnimplementedCommand(text)) return;

    // Execute message
    executeMessage(content, attachments);
  }, [checkNewSessionCommand, checkLocalCommand, checkContextCommand, checkSettingsPageCommand, checkEffortCommand, checkUnimplementedCommand, executeMessage]);

  /**
   * Interrupt the current session
   */
  const interruptSession = useCallback(() => {
    setLoading(false);
    setLoadingStartTime(null);
    setStreamingActive(false);
    isStreamingRef.current = false;

    sendBridgeEvent('interrupt_session');
  }, []);

  return {
    handleSubmit,
    executeMessage,
    interruptSession,
  };
}
